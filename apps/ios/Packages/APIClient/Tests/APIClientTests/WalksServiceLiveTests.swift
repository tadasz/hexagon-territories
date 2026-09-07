@testable import APIClient
import Core
import CoreTestSupport
import Foundation
import HTTPTypes
import OpenAPIRuntime
import XCTest

/// A `ClientTransport` answering from a script, recording every request (method, path, body).
private final class StubTransport: ClientTransport, @unchecked Sendable {
    struct Answer {
        var status: HTTPResponse.Status
        var body: String?
        var headers: HTTPFields = [:]
    }

    let state: Locked<(answers: [Answer], requests: [(HTTPRequest, String?)])>

    init(_ answers: [Answer]) {
        state = Locked((answers: answers, requests: []))
    }

    var requests: [(HTTPRequest, String?)] { state.value.requests }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
        var text: String?
        if let body {
            text = String(data: try await Data(collecting: body, upTo: 1 << 20), encoding: .utf8)
        }
        let answer = state.withLock { state -> Answer in
            state.requests.append((request, text))
            return state.answers.count > 1 ? state.answers.removeFirst() : state.answers[0]
        }
        var response = HTTPResponse(status: answer.status)
        response.headerFields = answer.headers
        response.headerFields[.contentType] = "application/json"
        return (response, answer.body.map { HTTPBody($0) })
    }
}

private struct StaticTokens: BearerTokenProvider {
    func validAccessToken() async throws -> String { "access-1" }
    func handleUnauthorized(failedAccessToken: String) async throws -> String { throw APIError.unauthorized }
}

final class WalksServiceLiveTests: XCTestCase {
    private let baseURL = URL(string: "http://localhost:3000")!

    /// The generated client pretty-prints JSON bodies; compare without whitespace (no value here contains spaces).
    private func compact(_ text: String?) -> String {
        (text ?? "").filter { !$0.isWhitespace }
    }

    private func makeService(_ answers: [StubTransport.Answer]) -> (WalksServiceLive, StubTransport) {
        let transport = StubTransport(answers)
        let client = Client(
            serverURL: baseURL,
            configuration: Configuration(dateTranscoder: LenientISO8601DateTranscoder()),
            transport: transport,
            middlewares: [ErrorEnvelopeMiddleware(), AuthMiddleware(tokens: StaticTokens())]
        )
        return (WalksServiceLive(client: client), transport)
    }

    private static let finishExample = """
    {"walkId":"2f9b7c1e-1b2c-4d3e-9f0a-1a2b3c4d5e6f","clientWalkId":"6d1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b",
     "status":"finished","finishReason":"client","startedAt":"2026-09-07T08:00:00.000Z","endedAt":"2026-09-07T08:35:10.000Z",
     "finishedAt":"2026-09-07T08:35:12.417Z","weekId":"2026-W37","distanceM":2611.4,"durationS":2110,"steps":3400,
     "sampleCount":422,"hexCount":5,"xp":26,"scored":true,"flags":[],
     "hexes":[{"h3":"891f40d1a4fffff","meters":812.3,"cappedMeters":812.3,"weekStanding":{"leader":1,"myFactionShare":0.64,"owner":null}}],
     "path":{"type":"LineString","coordinates":[[23.9320,54.9035],[23.9331,54.9041]]}}
    """

    func testCreateWalkMapsCreatedAndOk() async throws {
        let body = """
        {"walkId":"w-1","clientWalkId":"c-1","startedAt":"2026-09-07T10:00:00.000Z","status":"active","supersededWalkId":null}
        """
        let (service, transport) = makeService([.init(status: .created, body: body), .init(status: .ok, body: body)])
        let request = WalkCreateRequest(clientWalkId: "c-1", startedAt: Fixtures.now, deviceInfo: DeviceInfo(model: "iPhone14,5"))
        let first = try await service.createWalk(request)
        let second = try await service.createWalk(request)
        XCTAssertEqual(first, second)
        XCTAssertEqual(first.walkId, "w-1")
        XCTAssertEqual(first.status, .active)
        XCTAssertNil(first.supersededWalkId)
        XCTAssertEqual(transport.requests.count, 2)
        XCTAssertEqual(transport.requests[0].0.method, .post)
        XCTAssertEqual(transport.requests[0].0.path, "/v1/walks")
        XCTAssertEqual(transport.requests[0].0.headerFields[.authorization], "Bearer access-1")
        let sent = compact(transport.requests[0].1)
        XCTAssertTrue(sent.contains("\"clientWalkId\":\"c-1\""), sent)
        XCTAssertTrue(sent.contains("\"model\":\"iPhone14,5\""), sent)
        XCTAssertTrue(sent.contains("2026-09-07T10:00:00"), sent)
    }

    func testOverlapEnvelopeBecomesWalkOverlap() async {
        let body = #"{"error":{"code":"WALK_OVERLAP","message":"active walk","details":{"activeWalkId":"w-9"}},"requestId":"r"}"#
        let (service, _) = makeService([.init(status: .conflict, body: body)])
        do {
            _ = try await service.createWalk(WalkCreateRequest(clientWalkId: "c", startedAt: Fixtures.now))
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? APIError, .walkOverlap(activeWalkId: "w-9"))
            XCTAssertFalse((error as? APIError)?.isTransient ?? true)
        }
    }

    func testFactionRequiredAndNotFound() async {
        let (service, _) = makeService([
            .init(status: .forbidden, body: #"{"error":{"code":"FACTION_REQUIRED","message":"pick"},"requestId":"r"}"#),
            .init(status: .notFound, body: #"{"error":{"code":"WALK_NOT_FOUND","message":"no"},"requestId":"r"}"#),
        ])
        do {
            _ = try await service.createWalk(WalkCreateRequest(clientWalkId: "c", startedAt: Fixtures.now))
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? APIError, .factionRequired)
        }
        do {
            _ = try await service.walk(id: "other")
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? APIError, .walkNotFound)
        }
    }

    func testUploadSamplesMapsResultAndQuotaRetryAfter() async throws {
        var headers = HTTPFields()
        headers[.retryAfter] = "3600"
        let (service, transport) = makeService([
            .init(status: .ok, body: #"{"stored":2,"duplicates":1,"accepted":[0],"rejected":[{"seq":1,"reason":"speed"}],"sampleCount":3}"#),
            .init(status: .tooManyRequests, body: #"{"error":{"code":"SAMPLE_QUOTA_EXCEEDED","message":"quota"},"requestId":"r"}"#, headers: headers),
            .init(status: .conflict, body: #"{"error":{"code":"WALK_NOT_ACTIVE","message":"done"},"requestId":"r"}"#),
        ])
        let batch = SampleBatchRequest(
            samples: [
                LocationSample(seq: 0, ts: Fixtures.now, lat: 54.9, lon: 23.9, hAcc: 8, speed: 1.4),
                LocationSample(seq: 1, ts: Fixtures.now.addingTimeInterval(5), lat: 54.9001, lon: 23.9, hAcc: 8, speed: 6),
            ],
            pedometer: PedometerWindow(steps: 12, since: Fixtures.now, until: Fixtures.now.addingTimeInterval(5))
        )
        let result = try await service.uploadSamples(walkId: "w-1", batch)
        XCTAssertEqual(result, SampleBatchResult(stored: 2, duplicates: 1, accepted: [0], rejected: [.init(seq: 1, reason: .speed)], sampleCount: 3))
        XCTAssertEqual(transport.requests[0].0.path, "/v1/walks/w-1/samples")
        let sent = compact(transport.requests[0].1)
        XCTAssertTrue(sent.contains("\"hAcc\":8"), sent)
        XCTAssertTrue(sent.contains("\"pedometer\":{"), sent)

        do {
            _ = try await service.uploadSamples(walkId: "w-1", batch)
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? APIError, .sampleQuotaExceeded(retryAfterS: 3600), "retry-after header fills the missing details")
            XCTAssertTrue((error as? APIError)?.isTransient ?? false)
        }
        do {
            _ = try await service.uploadSamples(walkId: "w-1", batch)
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? APIError, .walkNotActive)
        }
    }

    func testFinishAndGetWalkDecodeTheContractExample() async throws {
        let (service, transport) = makeService([.init(status: .ok, body: Self.finishExample)])
        let summary = try await service.finishWalk(walkId: "w-1", WalkFinishRequest(endedAt: Fixtures.now, pedometerTotal: 3400))
        XCTAssertEqual(summary.hexCount, 5)
        XCTAssertEqual(summary.weekId, "2026-W37")
        XCTAssertEqual(summary.finishReason, .client)
        XCTAssertEqual(summary.hexes.first?.weekStanding.leader, 1)
        XCTAssertNil(summary.hexes.first?.weekStanding.owner)
        XCTAssertEqual(summary.path?.coordinates, [[23.9320, 54.9035], [23.9331, 54.9041]])
        XCTAssertEqual(summary.finishedAt, JSONCoding.parseISO8601("2026-09-07T08:35:12.417Z"))
        XCTAssertEqual(transport.requests[0].0.path, "/v1/walks/w-1/finish")
        XCTAssertEqual(compact(transport.requests[0].1), "{\"endedAt\":\"2026-09-07T10:00:00.000Z\",\"pedometerTotal\":3400}")

        let detail = try await service.walk(id: "w-1")
        XCTAssertEqual(detail, summary)
        XCTAssertEqual(transport.requests[1].0.method, .get)
        XCTAssertEqual(transport.requests[1].0.path, "/v1/walks/w-1")
    }

    func testFlaggedAndActiveSummariesDecode() async throws {
        let flagged = Self.finishExample
            .replacingOccurrences(of: "\"status\":\"finished\"", with: "\"status\":\"flagged\"")
            .replacingOccurrences(of: "\"flags\":[]", with: "\"flags\":[\"teleport\",\"no_steps\"]")
        let active = """
        {"walkId":"w","clientWalkId":"c","status":"active","finishReason":null,"startedAt":"2026-09-07T08:00:00Z",
         "endedAt":null,"finishedAt":null,"weekId":null,"distanceM":0,"durationS":0,"steps":null,"sampleCount":0,
         "hexCount":0,"xp":0,"scored":false,"flags":[],"hexes":[],"path":null}
        """
        let (service, _) = makeService([.init(status: .ok, body: flagged), .init(status: .ok, body: active)])
        let first = try await service.walk(id: "w")
        XCTAssertEqual(first.status, .flagged)
        XCTAssertEqual(first.flags, [.teleport, .noSteps])
        let second = try await service.walk(id: "w")
        XCTAssertEqual(second.status, .active)
        XCTAssertNil(second.finishReason)
        XCTAssertNil(second.path)
        XCTAssertNil(second.steps)
    }

    func testListWalksPassesCursorAndLimit() async throws {
        let page = """
        {"items":[{"walkId":"w1","clientWalkId":"c1","status":"finished","finishReason":"autofinish",
         "startedAt":"2026-09-06T08:00:00Z","endedAt":"2026-09-06T08:30:00Z","weekId":"2026-W36","distanceM":1200.5,
         "durationS":1800,"hexCount":3,"xp":12,"scored":true,"flags":[]}],"nextCursor":"next"}
        """
        let (service, transport) = makeService([.init(status: .ok, body: page)])
        let result = try await service.listWalks(cursor: "abc", limit: 20)
        XCTAssertEqual(result.items.map(\.walkId), ["w1"])
        XCTAssertEqual(result.items[0].finishReason, .autofinish)
        XCTAssertEqual(result.nextCursor, "next")
        let path = transport.requests[0].0.path ?? ""
        XCTAssertTrue(path.hasPrefix("/v1/walks?"), path)
        XCTAssertTrue(path.contains("cursor=abc"), path)
        XCTAssertTrue(path.contains("limit=20"), path)
    }

    func testTransportFailureIsNetwork() async {
        struct Boom: Error {}
        final class FailingTransport: ClientTransport {
            func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
                throw Boom()
            }
        }
        let client = Client(serverURL: baseURL, transport: FailingTransport(), middlewares: [ErrorEnvelopeMiddleware(), AuthMiddleware(tokens: StaticTokens())])
        do {
            _ = try await WalksServiceLive(client: client).listWalks(cursor: nil, limit: nil)
            XCTFail("expected an error")
        } catch {
            guard case .network = error as? APIError else { return XCTFail("expected .network, got \(error)") }
        }
    }
}
