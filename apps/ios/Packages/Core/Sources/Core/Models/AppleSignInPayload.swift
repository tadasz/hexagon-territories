import Foundation

/// Name components Apple hands over on the first authorization only (plan.md Shared Semantics 1).
public struct PersonName: Codable, Sendable, Equatable {
    public var givenName: String?
    public var familyName: String?

    public init(givenName: String?, familyName: String?) {
        self.givenName = givenName
        self.familyName = familyName
    }

    /// `nil` when Apple supplied neither part, so the request omits `fullName` entirely.
    public var isEmpty: Bool {
        (givenName ?? "").isEmpty && (familyName ?? "").isEmpty
    }
}

/// Body of `POST /v1/auth/apple` (data-model.md §2.1). `authorizationCode` is accepted by the API and unused in 002.
public struct AppleSignInPayload: Codable, Sendable, Equatable {
    public var identityToken: String
    public var authorizationCode: String?
    public var fullName: PersonName?

    public init(identityToken: String, authorizationCode: String? = nil, fullName: PersonName? = nil) {
        self.identityToken = identityToken
        self.authorizationCode = authorizationCode
        self.fullName = fullName.flatMap { $0.isEmpty ? nil : $0 }
    }
}
