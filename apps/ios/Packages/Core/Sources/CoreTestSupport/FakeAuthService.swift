import Core
import Foundation

/// Scriptable `AuthService`: results are set by tests, calls are recorded.
public final class FakeAuthService: AuthService, @unchecked Sendable {
    public typealias RefreshHandler = @Sendable (String) async throws -> TokenPair

    private let state: Locked<State>

    private struct State: Sendable {
        var signInResult: Result<AuthResult, any Error>
        var refreshHandler: RefreshHandler
        var logoutError: (any Error)?
        var signInCalls: [AppleSignInPayload] = []
        var refreshCalls: [String] = []
        var logoutCalls: [String] = []
    }

    public init(
        signInResult: Result<AuthResult, any Error> = .success(Fixtures.authResult()),
        refreshHandler: @escaping RefreshHandler = { _ in Fixtures.tokenPair(access: "access-2", refresh: "refresh-2") }
    ) {
        state = Locked(State(signInResult: signInResult, refreshHandler: refreshHandler, logoutError: nil))
    }

    public var signInResult: Result<AuthResult, any Error> {
        get { state.value.signInResult }
        set { state.withLock { $0.signInResult = newValue } }
    }

    public var refreshHandler: RefreshHandler {
        get { state.value.refreshHandler }
        set { state.withLock { $0.refreshHandler = newValue } }
    }

    public var logoutError: (any Error)? {
        get { state.value.logoutError }
        set { state.withLock { $0.logoutError = newValue } }
    }

    public var signInCalls: [AppleSignInPayload] { state.value.signInCalls }
    public var refreshCalls: [String] { state.value.refreshCalls }
    public var logoutCalls: [String] { state.value.logoutCalls }

    /// Every refresh returns `pair`.
    public func refreshReturning(_ pair: TokenPair) {
        refreshHandler = { _ in pair }
    }

    /// Every refresh throws `error`.
    public func refreshFailing(_ error: any Error) {
        refreshHandler = { _ in throw error }
    }

    public func signInWithApple(_ payload: AppleSignInPayload) async throws -> AuthResult {
        let result = state.withLock { state -> Result<AuthResult, any Error> in
            state.signInCalls.append(payload)
            return state.signInResult
        }
        return try result.get()
    }

    public func refresh(refreshToken: String) async throws -> TokenPair {
        let handler = state.withLock { state -> RefreshHandler in
            state.refreshCalls.append(refreshToken)
            return state.refreshHandler
        }
        return try await handler(refreshToken)
    }

    public func logout(refreshToken: String) async throws {
        let error = state.withLock { state -> (any Error)? in
            state.logoutCalls.append(refreshToken)
            return state.logoutError
        }
        if let error { throw error }
    }
}
