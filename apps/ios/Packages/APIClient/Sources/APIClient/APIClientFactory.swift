import Core
import Foundation
import OpenAPIRuntime
import OpenAPIURLSession
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Everything `AppContainer` needs from this package: the session and the three protocol-typed services.
public struct LiveServices: Sendable {
    public let session: AuthSession
    public let auth: any AuthService
    public let factions: any FactionsService
    public let profile: any ProfileService
    /// Feature 003: the five walk endpoints.
    public let walks: any WalksService

    public init(
        session: AuthSession,
        auth: any AuthService,
        factions: any FactionsService,
        profile: any ProfileService,
        walks: any WalksService
    ) {
        self.session = session
        self.auth = auth
        self.factions = factions
        self.profile = profile
        self.walks = walks
    }
}

/// Builds the generated `Client` with the URLSession transport and the two middlewares (research.md R11).
public enum APIClientFactory {
    public static func makeClient(
        baseURL: URL,
        tokens: any BearerTokenProvider,
        urlSession: URLSession = .shared
    ) -> Client {
        Client(
            serverURL: baseURL,
            configuration: Configuration(dateTranscoder: LenientISO8601DateTranscoder()),
            transport: URLSessionTransport(configuration: .init(session: urlSession)),
            middlewares: [ErrorEnvelopeMiddleware(), AuthMiddleware(tokens: tokens)]
        )
    }

    /// Wires the cycle client → `AuthServiceLive` → `AuthSession` → middleware: the middleware holds a reference
    /// that is filled once the session exists.
    public static func makeServices(
        baseURL: URL,
        tokenStore: any TokenStore,
        clock: any Clock = SystemClock(),
        urlSession: URLSession = .shared
    ) -> LiveServices {
        let reference = SessionReference()
        let client = makeClient(baseURL: baseURL, tokens: reference, urlSession: urlSession)
        let auth = AuthServiceLive(client: client)
        let session = AuthSession(service: auth, store: tokenStore, clock: clock)
        reference.session = session
        return LiveServices(
            session: session,
            auth: auth,
            factions: FactionsServiceLive(client: client),
            profile: ProfileServiceLive(client: client),
            walks: WalksServiceLive(client: client)
        )
    }
}

/// Late-bound `BearerTokenProvider` so the client can be built before the session that uses it.
final class SessionReference: BearerTokenProvider, @unchecked Sendable {
    private let lock = NSLock()
    private var stored: AuthSession?

    var session: AuthSession? {
        get { lock.withLock { stored } }
        set { lock.withLock { stored = newValue } }
    }

    func validAccessToken() async throws -> String {
        guard let session else { throw APIError.unauthorized }
        return try await session.validAccessToken()
    }

    func handleUnauthorized(failedAccessToken: String) async throws -> String {
        guard let session else { throw APIError.unauthorized }
        return try await session.handleUnauthorized(failedAccessToken: failedAccessToken)
    }
}
