import Foundation

/// `POST /v1/auth/apple` answer (data-model.md §2.1 `AuthResponse`).
public struct AuthResult: Sendable, Equatable {
    public var tokens: TokenPair
    public var me: Me
    public var isNewUser: Bool
    /// True when an account marked deleted was reactivated by this sign-in.
    public var restored: Bool

    public init(tokens: TokenPair, me: Me, isNewUser: Bool, restored: Bool) {
        self.tokens = tokens
        self.me = me
        self.isNewUser = isNewUser
        self.restored = restored
    }
}

/// The three auth operations; implemented by `APIClient.AuthServiceLive` over the generated client and by fakes.
public protocol AuthService: Sendable {
    func signInWithApple(_ payload: AppleSignInPayload) async throws -> AuthResult
    func refresh(refreshToken: String) async throws -> TokenPair
    func logout(refreshToken: String) async throws
}
