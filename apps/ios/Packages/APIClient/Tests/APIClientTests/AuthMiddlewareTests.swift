@testable import APIClient
import Core
import CoreTestSupport
import Foundation
import HTTPTypes
import OpenAPIRuntime
import XCTest

/// Scripted `BearerTokenProvider`.
private final class FakeTokens: BearerTokenProvider, @unchecked Sendable {
    let state = Locked((
        valid: "access-1",
        refreshed: Result<String, any Error>.success("access-2"),
        validCalls: 0,
        unauthorizedCalls: [String]()
    ))

    func validAccessToken() async throws -> String {
        state.withLock { $0.validCalls += 1; return $0.valid }
    }

    func handleUnauthorized(failedAccessToken: String) async throws -> String {
        try state.withLock { state -> Result<String, any Error> in
            state.unauthorizedCalls.append(failedAccessToken)
            return state.refreshed
        }.get()
    }
}

/// Records what reached the transport and answers from a queue of statuses.
private final class FakeNext: @unchecked Sendable {
    let state: Locked<(statuses: [HTTPResponse.Status], requests: [HTTPRequest])>

    init(_ statuses: [HTTPResponse.Status]) {
        state = Locked((statuses: statuses, requests: []))
    }

    var requests: [HTTPRequest] { state.value.requests }
    var authorizations: [String?] { requests.map { $0.headerFields[.authorization] } }

    @Sendable func call(_ request: HTTPRequest, _ body: HTTPBody?, _ url: URL) async throws -> (HTTPResponse, HTTPBody?) {
        let status = state.withLock { state -> HTTPResponse.Status in
            state.requests.append(request)
            return state.statuses.count > 1 ? state.statuses.removeFirst() : state.statuses[0]
        }
        return (HTTPResponse(status: status), nil)
    }
}

final class AuthMiddlewareTests: XCTestCase {
    private let baseURL = URL(string: "http://localhost:3000")!
    private let request = HTTPRequest(method: .get, scheme: "http", authority: "localhost:3000", path: "/v1/me")
    private let jsonBody = HTTPBody("{\"factionId\":1}")

    private func run(
        _ middleware: AuthMiddleware,
        operation: String = "getMe",
        body: HTTPBody? = nil,
        next: FakeNext
    ) async throws -> HTTPResponse {
        try await middleware.intercept(request, body: body, baseURL: baseURL, operationID: operation, next: next.call).0
    }

    func testPublicOperationsGetNoHeaderAndNoToken() async throws {
        let tokens = FakeTokens()
        let next = FakeNext([.ok])
        for operation in ["signInWithApple", "refreshTokens", "listFactions"] {
            _ = try await run(AuthMiddleware(tokens: tokens), operation: operation, next: next)
        }
        XCTAssertEqual(next.authorizations, [nil, nil, nil])
        XCTAssertEqual(tokens.state.value.validCalls, 0)
    }

    func testBearerHeaderIsAdded() async throws {
        let next = FakeNext([.ok])
        let response = try await run(AuthMiddleware(tokens: FakeTokens()), next: next)
        XCTAssertEqual(response.status, .ok)
        XCTAssertEqual(next.authorizations, ["Bearer access-1"])
    }

    func testRetriesOnceAfter401WithTheRefreshedToken() async throws {
        let tokens = FakeTokens()
        let next = FakeNext([.unauthorized, .ok])
        let response = try await run(AuthMiddleware(tokens: tokens), body: jsonBody, next: next)
        XCTAssertEqual(response.status, .ok)
        XCTAssertEqual(next.authorizations, ["Bearer access-1", "Bearer access-2"])
        XCTAssertEqual(tokens.state.value.unauthorizedCalls, ["access-1"])
    }

    func testDoesNotRetryASecond401() async throws {
        let tokens = FakeTokens()
        let next = FakeNext([.unauthorized, .unauthorized])
        let response = try await run(AuthMiddleware(tokens: tokens), next: next)
        XCTAssertEqual(response.status, .unauthorized)
        XCTAssertEqual(next.requests.count, 2, "one retry, never a third attempt")
        XCTAssertEqual(tokens.state.value.unauthorizedCalls.count, 1)
    }

    func testSessionEndingRefreshPropagatesAndStopsRetrying() async {
        let tokens = FakeTokens()
        tokens.state.withLock { $0.refreshed = .failure(APIError.refreshReused) }
        let next = FakeNext([.unauthorized, .ok])
        do {
            _ = try await run(AuthMiddleware(tokens: tokens), next: next)
            XCTFail("expected refreshReused")
        } catch {
            XCTAssertEqual(error as? APIError, .refreshReused)
        }
        XCTAssertEqual(next.requests.count, 1)
    }

    func testSignedOutSessionFailsBeforeSending() async {
        let tokens = FakeTokens()
        tokens.state.withLock { $0.valid = "" }
        let failing = FailingTokens()
        let next = FakeNext([.ok])
        do {
            _ = try await run(AuthMiddleware(tokens: failing), next: next)
            XCTFail("expected unauthorized")
        } catch {
            XCTAssertEqual(error as? APIError, .unauthorized)
        }
        XCTAssertTrue(next.requests.isEmpty)
    }

    func testNonReplayableBodyIsNotRetried() async throws {
        let streamed = HTTPBody(
            AsyncStream<ArraySlice<UInt8>> { continuation in
                continuation.yield(ArraySlice("{}".utf8))
                continuation.finish()
            },
            length: .unknown,
            iterationBehavior: .single
        )
        let next = FakeNext([.unauthorized, .ok])
        let response = try await run(AuthMiddleware(tokens: FakeTokens()), body: streamed, next: next)
        XCTAssertEqual(response.status, .unauthorized)
        XCTAssertEqual(next.requests.count, 1)
    }

    func testWithRealSessionRefreshesExpiredTokenBeforeSending() async throws {
        let clock = FakeClock()
        let store = RecordingTokenStore(Fixtures.tokenPair())
        let service = FakeAuthService()
        let later = clock.now().addingTimeInterval(1_000)
        service.refreshReturning(Fixtures.tokenPair(access: "access-2", refresh: "refresh-2", from: later))
        let session = AuthSession(service: service, store: store, clock: clock)
        await session.restore()
        clock.advance(by: 1_000)

        let next = FakeNext([.ok])
        _ = try await run(AuthMiddleware(tokens: session), next: next)
        XCTAssertEqual(next.authorizations, ["Bearer access-2"])
        XCTAssertEqual(service.refreshCalls, ["refresh-1"])
    }
}

private struct FailingTokens: BearerTokenProvider {
    func validAccessToken() async throws -> String { throw APIError.unauthorized }
    func handleUnauthorized(failedAccessToken: String) async throws -> String { throw APIError.unauthorized }
}
