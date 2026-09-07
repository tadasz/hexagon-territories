import Core
import Foundation

/// `ProfileService` over the generated client (`/v1/me`, `/v1/me/faction`, `/v1/me/export`).
public struct ProfileServiceLive: ProfileService {
    private let client: Client

    public init(client: Client) {
        self.client = client
    }

    public func me() async throws -> Me {
        try await performRequest {
            switch try await client.getMe() {
            case let .ok(ok): try ok.body.json.core
            case let .undocumented(status, _): throw unexpectedResponse(status: status)
            default: throw unexpectedResponse(status: 0)
            }
        }
    }

    public func updateDisplayName(_ displayName: String) async throws -> Me {
        try await performRequest {
            switch try await client.updateMe(body: .json(.init(displayName: displayName))) {
            case let .ok(ok): try ok.body.json.core
            case let .undocumented(status, _): throw unexpectedResponse(status: status)
            default: throw unexpectedResponse(status: 0)
            }
        }
    }

    public func selectFaction(_ factionId: Int) async throws -> Me {
        try await performRequest {
            switch try await client.selectFaction(body: .json(.init(factionId: factionId))) {
            case let .ok(ok): try ok.body.json.core
            case let .undocumented(status, _): throw unexpectedResponse(status: status)
            default: throw unexpectedResponse(status: 0)
            }
        }
    }

    public func deleteAccount() async throws -> AccountDeletion {
        try await performRequest {
            switch try await client.deleteMe() {
            case let .ok(ok): try ok.body.json.core
            case let .undocumented(status, _): throw unexpectedResponse(status: status)
            default: throw unexpectedResponse(status: 0)
            }
        }
    }

    public func export() async throws -> ExportStatus {
        try await performRequest {
            switch try await client.getExport() {
            case let .ok(ok): try ok.body.json.core
            case let .accepted(accepted): try accepted.body.json.core
            case let .undocumented(status, _): throw unexpectedResponse(status: status)
            default: throw unexpectedResponse(status: 0)
            }
        }
    }
}
