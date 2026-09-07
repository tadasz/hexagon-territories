import Core
import Foundation

/// `AuthService` over the generated client (`POST /v1/auth/apple`, `/refresh`, `/logout`).
public struct AuthServiceLive: AuthService {
    private let client: Client

    public init(client: Client) {
        self.client = client
    }

    public func signInWithApple(_ payload: AppleSignInPayload) async throws -> AuthResult {
        try await performRequest {
            switch try await client.signInWithApple(body: .json(.init(payload))) {
            case let .ok(ok): try ok.body.json.core
            case let .undocumented(status, _): throw unexpectedResponse(status: status)
            default: throw unexpectedResponse(status: 0)
            }
        }
    }

    public func refresh(refreshToken: String) async throws -> TokenPair {
        try await performRequest {
            switch try await client.refreshTokens(body: .json(.init(refreshToken: refreshToken))) {
            case let .ok(ok): try ok.body.json.core
            case let .undocumented(status, _): throw unexpectedResponse(status: status)
            default: throw unexpectedResponse(status: 0)
            }
        }
    }

    public func logout(refreshToken: String) async throws {
        try await performRequest {
            switch try await client.logout(body: .json(.init(refreshToken: refreshToken))) {
            case .noContent: ()
            case let .undocumented(status, _): throw unexpectedResponse(status: status)
            default: throw unexpectedResponse(status: 0)
            }
        }
    }
}
