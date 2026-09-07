import Foundation

/// Access + refresh token pair (data-model.md §2.1). Stored JSON-encoded in one Keychain item (research.md R12).
public struct TokenPair: Codable, Sendable, Equatable {
    public var accessToken: String
    public var accessExpiresAt: Date
    public var refreshToken: String
    public var refreshExpiresAt: Date

    public init(accessToken: String, accessExpiresAt: Date, refreshToken: String, refreshExpiresAt: Date) {
        self.accessToken = accessToken
        self.accessExpiresAt = accessExpiresAt
        self.refreshToken = refreshToken
        self.refreshExpiresAt = refreshExpiresAt
    }

    /// The access token counts as expired `skew` seconds before `accessExpiresAt` (plan.md Shared Semantics 2).
    public func isAccessTokenValid(at now: Date, skew: TimeInterval) -> Bool {
        accessExpiresAt.timeIntervalSince(now) > skew
    }
}
