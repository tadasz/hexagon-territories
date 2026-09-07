@testable import APIClient
import Core
import Foundation
import HTTPTypes
import OpenAPIRuntime
import XCTest

final class ErrorEnvelopeMiddlewareTests: XCTestCase {
    private let baseURL = URL(string: "http://localhost:3000")!
    private let request = HTTPRequest(method: .post, scheme: "http", authority: "localhost:3000", path: "/v1/me/faction")

    private func intercept(
        status: HTTPResponse.Status,
        body: String?,
        headers: HTTPFields = [:]
    ) async throws -> HTTPResponse {
        let middleware = ErrorEnvelopeMiddleware()
        return try await middleware.intercept(request, body: nil, baseURL: baseURL, operationID: "selectFaction") { _, _, _ in
            var response = HTTPResponse(status: status)
            response.headerFields = headers
            return (response, body.map { HTTPBody($0) })
        }.0
    }

    func testSuccessPassesThrough() async throws {
        let response = try await intercept(status: .ok, body: "{}")
        XCTAssertEqual(response.status, .ok)
    }

    func testEnvelopeBecomesAPIError() async {
        let body = """
        {"error":{"code":"FACTION_CHANGE_LOCKED","message":"Faction can be changed once every 30 days",
         "details":{"nextChangeAt":"2026-10-07T10:00:00.000Z"}},"requestId":"6f1c2a4e"}
        """
        do {
            _ = try await intercept(status: .conflict, body: body)
            XCTFail("expected an error")
        } catch {
            let nextChangeAt = JSONCoding.parseISO8601("2026-10-07T10:00:00.000Z")!
            XCTAssertEqual(error as? APIError, .factionChangeLocked(nextChangeAt: nextChangeAt))
        }
    }

    func testRetryAfterHeaderFillsInMissingDetails() async {
        let body = #"{"error":{"code":"RATE_LIMITED","message":"slow down"},"requestId":"r"}"#
        var headers = HTTPFields()
        headers[.retryAfter] = "17"
        do {
            _ = try await intercept(status: .tooManyRequests, body: body, headers: headers)
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? APIError, .rateLimited(retryAfterS: 17))
        }
    }

    func testNonEnvelopeBodyIsUnexpected() async {
        do {
            _ = try await intercept(status: .internalServerError, body: "<html>oops</html>")
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? APIError, .unexpected(code: "HTTP_500", status: 500))
        }
        do {
            _ = try await intercept(status: .badGateway, body: nil)
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? APIError, .unexpected(code: "HTTP_502", status: 502))
        }
    }

    func testUnauthorizedEnvelopeMapsToSessionEndingError() async {
        let body = #"{"error":{"code":"ACCOUNT_DELETED","message":"deleted"},"requestId":"r"}"#
        do {
            _ = try await intercept(status: .unauthorized, body: body)
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? APIError, .accountDeleted)
            XCTAssertTrue((error as? APIError)?.endsSession ?? false)
        }
    }
}
