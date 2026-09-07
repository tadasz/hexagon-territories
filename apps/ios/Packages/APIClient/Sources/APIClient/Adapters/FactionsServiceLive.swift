import Core
import Foundation

/// `FactionsService` over the generated client (`GET /v1/factions`).
public struct FactionsServiceLive: FactionsService {
    private let client: Client

    public init(client: Client) {
        self.client = client
    }

    public func factions() async throws -> FactionsResponse {
        try await performRequest {
            switch try await client.listFactions() {
            case let .ok(ok): try ok.body.json.core
            case let .undocumented(status, _): throw unexpectedResponse(status: status)
            default: throw unexpectedResponse(status: 0)
            }
        }
    }
}
