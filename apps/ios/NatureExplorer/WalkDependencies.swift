import Core
import Foundation
import Location
import Persistence

/// Everything the Walk tab needs, built once by `AppContainer` (research.md R18): the GRDB database, the repository
/// (the tracker's `WalkStore`), the outbox and its `SyncCoordinator`, the tracker over the platform location source,
/// the observable `LivePath` (feature 005 reads it) and the permission gate.
struct WalkDependencies: Sendable {
    let walksService: any WalksService
    let repository: GRDBWalkRepository
    let outbox: OutboxQueue
    let sync: SyncCoordinator
    let tracker: WalkTracker
    let livePath: LivePath
    let permission: any LocationPermission
    /// False when `nature.sqlite` could not be opened and an in-memory database is used instead (the player is warned).
    let storeIsDurable: Bool

    /// The production graph: on-disk database (in-memory fallback), Core Location, Core Motion.
    @MainActor
    static func live(walksService: any WalksService) -> WalkDependencies {
        var durable = true
        let db: WalkDatabase
        do {
            db = try WalkDatabase.openDefault()
        } catch {
            durable = false
            db = (try? WalkDatabase.inMemory()) ?? { fatalError("SQLite unavailable: \(error)") }()
        }
        #if canImport(CoreLocation) && canImport(CoreMotion)
        let source: any LocationSource = CoreLocationSource()
        let pedometer: (any PedometerSource)? = PedometerBridge()
        let permission: any LocationPermission = CoreLocationPermission()
        #else
        let source: any LocationSource = UnavailableLocationSource()
        let pedometer: (any PedometerSource)? = nil
        let permission: any LocationPermission = UnavailableLocationPermission()
        #endif
        return make(db: db, walksService: walksService, source: source, pedometer: pedometer, permission: permission, durable: durable)
    }

    /// An in-memory graph with the given source and permission (previews, tests).
    @MainActor
    static func inMemory(
        walksService: any WalksService,
        source: any LocationSource = UnavailableLocationSource(),
        permission: any LocationPermission = UnavailableLocationPermission(),
        clock: any Clock = SystemClock()
    ) -> WalkDependencies {
        let db = (try? WalkDatabase.inMemory()) ?? { fatalError("in-memory SQLite unavailable") }()
        return make(db: db, walksService: walksService, source: source, pedometer: nil, permission: permission, durable: false, clock: clock)
    }

    @MainActor
    private static func make(
        db: WalkDatabase,
        walksService: any WalksService,
        source: any LocationSource,
        pedometer: (any PedometerSource)?,
        permission: any LocationPermission,
        durable: Bool,
        clock: any Clock = SystemClock()
    ) -> WalkDependencies {
        let repository = GRDBWalkRepository(database: db, clock: clock)
        let outbox = OutboxQueue(database: db)
        let sync = SyncCoordinator(repository: repository, outbox: outbox, service: walksService, clock: clock)
        let livePath = LivePath()
        let tracker = WalkTracker(source: source, pedometer: pedometer, store: repository, livePath: livePath, clock: clock)
        return WalkDependencies(
            walksService: walksService,
            repository: repository,
            outbox: outbox,
            sync: sync,
            tracker: tracker,
            livePath: livePath,
            permission: permission,
            storeIsDurable: durable
        )
    }
}

/// A source that cannot start (macOS previews, Linux tests of the container).
struct UnavailableLocationSource: LocationSource {
    func start() throws { throw LocationSourceError.unavailable("no location source on this platform") }
    func updates() -> AsyncThrowingStream<LocationFix, any Error> { AsyncThrowingStream { $0.finish() } }
    func stop() {}
}

struct UnavailableLocationPermission: LocationPermission {
    func status() -> LocationAuthorization { .restricted }
    func requestWhenInUse() async -> LocationAuthorization { .restricted }
}

/// `WalksService` for containers built without a network (previews): every call fails as offline, so walks stay
/// queued in the outbox.
struct OfflineWalksService: WalksService {
    struct Offline: Error {}

    func createWalk(_ request: WalkCreateRequest) async throws -> WalkCreated { throw APIError.network(underlying: Offline()) }
    func uploadSamples(walkId: String, _ batch: SampleBatchRequest) async throws -> SampleBatchResult { throw APIError.network(underlying: Offline()) }
    func finishWalk(walkId: String, _ request: WalkFinishRequest) async throws -> WalkSummary { throw APIError.network(underlying: Offline()) }
    func listWalks(cursor: String?, limit: Int?) async throws -> WalkListPage { throw APIError.network(underlying: Offline()) }
    func walk(id: String) async throws -> WalkSummary { throw APIError.network(underlying: Offline()) }
}
