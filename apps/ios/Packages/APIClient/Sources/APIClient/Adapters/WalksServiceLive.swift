import Core
import Foundation

/// `WalksService` over the generated client (`/v1/walks`, `/v1/walks/{id}/samples`, `/v1/walks/{id}/finish`,
/// `/v1/walks/{id}`). Non-2xx answers never reach here: `ErrorEnvelopeMiddleware` maps them to `APIError`
/// (walk codes included; `retry-after` fills a 429 without `retryAfterS`).
public struct WalksServiceLive: WalksService {
    private let client: Client

    public init(client: Client) {
        self.client = client
    }

    public func createWalk(_ request: WalkCreateRequest) async throws -> WalkCreated {
        try await performRequest {
            switch try await client.createWalk(body: .json(.init(request))) {
            case let .created(created): try created.body.json.core
            case let .ok(ok): try ok.body.json.core
            case let .undocumented(status, _): throw unexpectedResponse(status: status)
            default: throw unexpectedResponse(status: 0)
            }
        }
    }

    public func uploadSamples(walkId: String, _ batch: SampleBatchRequest) async throws -> SampleBatchResult {
        try await performRequest {
            switch try await client.uploadWalkSamples(path: .init(id: walkId), body: .json(.init(batch))) {
            case let .ok(ok): try ok.body.json.core
            case let .undocumented(status, _): throw unexpectedResponse(status: status)
            default: throw unexpectedResponse(status: 0)
            }
        }
    }

    public func finishWalk(walkId: String, _ request: WalkFinishRequest) async throws -> WalkSummary {
        try await performRequest {
            switch try await client.finishWalk(path: .init(id: walkId), body: .json(.init(request))) {
            case let .ok(ok): try ok.body.json.core
            case let .undocumented(status, _): throw unexpectedResponse(status: status)
            default: throw unexpectedResponse(status: 0)
            }
        }
    }

    public func listWalks(cursor: String?, limit: Int?) async throws -> WalkListPage {
        try await performRequest {
            switch try await client.listWalks(query: .init(cursor: cursor, limit: limit)) {
            case let .ok(ok): try ok.body.json.core
            case let .undocumented(status, _): throw unexpectedResponse(status: status)
            default: throw unexpectedResponse(status: 0)
            }
        }
    }

    public func walk(id: String) async throws -> WalkSummary {
        try await performRequest {
            switch try await client.getWalk(path: .init(id: id)) {
            case let .ok(ok): try ok.body.json.core
            case let .undocumented(status, _): throw unexpectedResponse(status: status)
            default: throw unexpectedResponse(status: 0)
            }
        }
    }
}
