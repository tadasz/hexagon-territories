import Foundation

/// What the UI sees (research.md R12). `.refreshing` still counts as signed in: the gate must not flash the
/// sign-in screen while a refresh is in flight.
public enum AuthState: Sendable, Equatable {
    case signedOut
    case signedIn(TokenPair)
    case refreshing

    public var isSignedIn: Bool {
        if case .signedOut = self { return false }
        return true
    }
}

/// Provides bearer tokens to the HTTP layer; `AuthSession` is the implementation, the `APIClient` middleware the
/// consumer. Kept as a protocol so the middleware can be tested without a network.
public protocol BearerTokenProvider: Sendable {
    /// A token that is valid for at least the skew window, refreshing first if needed.
    func validAccessToken() async throws -> String
    /// Called after a request answered 401 with `failedAccessToken`: refreshes once (single-flight) and returns the
    /// replacement, or throws when the session is over.
    func handleUnauthorized(failedAccessToken: String) async throws -> String
}

/// The session state machine (research.md R12, plan.md Shared Semantics 2–4):
///
/// - `restore()` loads the pair from the `TokenStore` at launch (offline-safe: nothing is verified);
/// - `signIn(_:)` exchanges Apple's identity token for a pair and persists it;
/// - `validAccessToken()` returns the access token while it is valid for more than `skew` seconds, else refreshes;
/// - `refresh()` is single-flight: concurrent callers await the one in-flight refresh;
/// - a refresh failing with a session-ending `APIError` (401 family) clears the store and emits `.signedOut`;
///   any other failure (network, 5xx, rate limit) keeps the current pair and rethrows;
/// - `signOut()` revokes the refresh token best-effort and always clears the store.
public actor AuthSession: BearerTokenProvider {
    /// Seconds before `accessExpiresAt` at which the token is treated as expired (clock skew).
    public static let defaultSkew: TimeInterval = 30

    public private(set) var state: AuthState = .signedOut
    /// Every state transition, for the `@MainActor` mirror in `AppContainer`. One consumer; the newest 16 changes
    /// are buffered until it starts iterating.
    public nonisolated let authStateChanges: AsyncStream<AuthState>

    private let continuation: AsyncStream<AuthState>.Continuation
    private let service: any AuthService
    private let store: any TokenStore
    private let clock: any Clock
    private let skew: TimeInterval
    private var current: TokenPair?
    private var refreshTask: Task<TokenPair, any Error>?

    public init(
        service: any AuthService,
        store: any TokenStore,
        clock: any Clock = SystemClock(),
        skew: TimeInterval = AuthSession.defaultSkew
    ) {
        let (stream, continuation) = AsyncStream<AuthState>.makeStream(bufferingPolicy: .bufferingNewest(16))
        authStateChanges = stream
        self.continuation = continuation
        self.service = service
        self.store = store
        self.clock = clock
        self.skew = skew
    }

    deinit {
        continuation.finish()
    }

    /// The pair in use, if any (also while refreshing).
    public var currentTokens: TokenPair? { current }

    /// Loads the persisted pair. A store that throws counts as empty and is cleared best-effort.
    @discardableResult
    public func restore() -> AuthState {
        do {
            if let pair = try store.load() {
                current = pair
                setState(.signedIn(pair))
            } else {
                current = nil
                setState(.signedOut)
            }
        } catch {
            current = nil
            try? store.clear()
            setState(.signedOut)
        }
        return state
    }

    public func signIn(_ payload: AppleSignInPayload) async throws -> AuthResult {
        let result = try await service.signInWithApple(payload)
        adopt(result.tokens)
        return result
    }

    public func validAccessToken() async throws -> String {
        if let task = refreshTask {
            return try await task.value.accessToken
        }
        guard let pair = current else { throw APIError.unauthorized }
        if pair.isAccessTokenValid(at: clock.now(), skew: skew) {
            return pair.accessToken
        }
        return try await refresh().accessToken
    }

    public func handleUnauthorized(failedAccessToken: String) async throws -> String {
        if let task = refreshTask {
            return try await task.value.accessToken
        }
        guard let pair = current else { throw APIError.unauthorized }
        // Another caller already rotated the pair: retry with the newer token instead of refreshing twice.
        if pair.accessToken != failedAccessToken {
            return pair.accessToken
        }
        return try await refresh().accessToken
    }

    /// Rotates the pair (`POST /v1/auth/refresh`). Single-flight.
    @discardableResult
    public func refresh() async throws -> TokenPair {
        if let task = refreshTask {
            return try await task.value
        }
        guard let pair = current else { throw APIError.unauthorized }
        let service = self.service
        let task = Task { try await service.refresh(refreshToken: pair.refreshToken) }
        refreshTask = task
        setState(.refreshing)
        defer { refreshTask = nil }
        do {
            let fresh = try await task.value
            // Signed out while the refresh was in flight: do not resurrect the session.
            guard current != nil else { throw APIError.unauthorized }
            adopt(fresh)
            return fresh
        } catch let error as APIError where error.endsSession {
            clearLocally()
            throw error
        } catch {
            if current == pair {
                setState(.signedIn(pair))
            }
            throw error
        }
    }

    /// Revokes this device's refresh token best-effort, then clears the local session (FR-003).
    public func signOut() async {
        guard let pair = current else {
            clearLocally()
            return
        }
        try? await service.logout(refreshToken: pair.refreshToken)
        clearLocally()
    }

    /// Clears the store and emits `.signedOut` without calling the API — after `DELETE /v1/me`, whose response
    /// already revoked every token (plan.md Shared Semantics 11).
    public func clearLocalSession() {
        clearLocally()
    }

    private func adopt(_ pair: TokenPair) {
        current = pair
        try? store.save(pair)
        setState(.signedIn(pair))
    }

    private func clearLocally() {
        current = nil
        try? store.clear()
        setState(.signedOut)
    }

    private func setState(_ new: AuthState) {
        guard new != state else { return }
        state = new
        continuation.yield(new)
    }
}
