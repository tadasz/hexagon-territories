import APIClient
import AuthFeature
import Core
import Foundation
import Location
import MapFeature
import Observation
import Persistence

/// Dependency container: the single place that builds concrete services and hands them to features as protocol-typed
/// values (`docs/architecture.md` §4). Feature 002 adds the session (`AuthSession` over the Keychain), the generated
/// API client and the profile that gates the tab bar (research.md R12). `sessionState` and `me` are the
/// `@MainActor` mirror of the actor's state that `RootView` observes.
@MainActor
@Observable
final class AppContainer {
    /// Map style and initial camera, from the bundle's Info.plist (`MAP_STYLE_URL` override) or the defaults.
    var mapConfig: MapConfig

    let session: AuthSession
    let authService: any AuthService
    let factionsService: any FactionsService
    let profileService: any ProfileService
    /// Feature 003: walks (service, local store, outbox/sync, tracker, live path).
    let walks: WalkDependencies

    /// Mirror of `AuthSession.state`, fed by `authStateChanges`.
    private(set) var sessionState: AuthState = .signedOut
    /// The signed-in player's profile; `nil` until loaded (or when signed out).
    private(set) var me: Me?
    /// True until the Keychain session has been restored at launch.
    private(set) var isRestoring = true
    /// Set when the profile could not be loaded and nothing is cached: the loading screen offers a retry.
    private(set) var profileError: String?

    private let profileCache: ProfileCache
    private var observation: Task<Void, Never>?

    init(
        session: AuthSession,
        auth: any AuthService,
        factions: any FactionsService,
        profile: any ProfileService,
        walks: WalkDependencies? = nil,
        mapConfig: MapConfig = MapConfig.fromBundle(),
        profileCache: ProfileCache = .inMemory()
    ) {
        self.session = session
        authService = auth
        factionsService = factions
        profileService = profile
        self.walks = walks ?? WalkDependencies.inMemory(walksService: OfflineWalksService())
        self.mapConfig = mapConfig
        self.profileCache = profileCache
    }

    /// The production container: Keychain-backed session and the generated client at `API_BASE_URL`.
    static func live() -> AppContainer {
        let services = APIClientFactory.makeServices(baseURL: AppConfig.apiBaseURL(), tokenStore: KeychainStore())
        return AppContainer(
            session: services.session,
            auth: services.auth,
            factions: services.factions,
            profile: services.profile,
            walks: WalkDependencies.live(walksService: services.walks),
            profileCache: .userDefaults()
        )
    }

    /// Launch / foreground housekeeping for walks (FR-004, FR-015): finish a walk left recording by a kill (its
    /// finish goes to the outbox), delete raw samples older than 7 days, drain the outbox.
    func resumeWalks() async {
        if let recovered = try? await walks.tracker.recover() {
            try? await walks.sync.walkFinished(recovered)
        }
        try? walks.repository.vacuum(now: Date())
        await walks.sync.kick()
    }

    /// What `RootView` shows (research.md R12).
    var gate: SessionGate {
        SessionGate.decide(session: sessionState, me: me, isRestoring: isRestoring)
    }

    /// Restores the persisted session, mirrors every later state change and loads the profile. Idempotent.
    func start() async {
        guard observation == nil else { return }
        let session = self.session
        observation = Task { [weak self] in
            for await state in session.authStateChanges {
                guard let self else { return }
                apply(state)
            }
        }
        let state = await session.restore()
        apply(state)
        isRestoring = false
        if state.isSignedIn {
            await loadProfile()
        }
    }

    func stop() {
        observation?.cancel()
        observation = nil
    }

    /// `GET /v1/me`; falls back to the cached profile so an offline launch still reaches the tabs.
    func loadProfile() async {
        profileError = nil
        if me == nil, let cached = profileCache.load() {
            me = cached
        }
        do {
            update(me: try await profileService.me())
        } catch let error as APIError where error.endsSession {
            // The session actor already cleared the Keychain and emitted `.signedOut`.
        } catch {
            if me == nil {
                profileError = (error as? APIError ?? APIError.network(underlying: error)).userMessage
            }
        }
    }

    /// Adopts a profile returned by any feature (sign-in, faction pick, name edit) and caches it.
    func update(me new: Me?) {
        me = new
        if let new {
            profileCache.save(new)
        } else {
            profileCache.clear()
        }
    }

    func signedIn(_ result: AuthResult) {
        update(me: result.me)
    }

    private func apply(_ state: AuthState) {
        sessionState = state
        if !state.isSignedIn {
            me = nil
            profileError = nil
            profileCache.clear()
        }
    }
}
