import Core
import CoreTestSupport
import Foundation
import H3Kit
import Location
import LocationTestSupport
import Persistence
import TerritoryRules
@testable import WalkFeature
import XCTest

/// The full walk graph with fakes at the edges: in-memory GRDB, `FakeWalksService`, `FakeLocationSource`,
/// `FakeLocationPermission`, `FakeClock`; the coordinator never kicks itself (`autoKick: false`).
@MainActor
struct WalkHarness {
    let database: WalkDatabase
    let repository: GRDBWalkRepository
    let outbox: OutboxQueue
    let service: FakeWalksService
    let sync: SyncCoordinator
    let source: FakeLocationSource
    let permission: FakeLocationPermission
    let clock: FakeClock
    let livePath: LivePath
    let tracker: WalkTracker
    let hasFaction: Locked<Bool>

    init(permission status: LocationAuthorization = .whenInUse, afterRequest: LocationAuthorization = .whenInUse) throws {
        database = try WalkDatabase.inMemory()
        clock = FakeClock(now: Date(timeIntervalSince1970: 1_788_768_000))
        repository = GRDBWalkRepository(database: database, clock: clock)
        outbox = OutboxQueue(database: database)
        service = FakeWalksService()
        sync = SyncCoordinator(
            repository: repository,
            outbox: outbox,
            service: service,
            clock: clock,
            backoff: Backoff(seed: 1),
            sleeper: { _ in try await Task.sleep(for: .seconds(100_000)) },
            autoKick: false
        )
        source = FakeLocationSource()
        permission = FakeLocationPermission(status: status, afterRequest: afterRequest)
        livePath = LivePath()
        tracker = WalkTracker(
            source: source,
            pedometer: FakePedometer(steps: 1200),
            store: repository,
            livePath: livePath,
            clock: clock,
            configuration: WalkTracker.Configuration(throttle: .disabled)
        )
        hasFaction = Locked(true)
    }

    func makeViewModel() -> WalkViewModel {
        let hasFaction = self.hasFaction
        return WalkViewModel(
            tracker: tracker,
            livePath: livePath,
            sync: sync,
            permission: permission,
            hasFaction: { hasFaction.value },
            deviceInfo: DeviceInfo(model: "iPhone14,5"),
            clock: clock,
            sleeper: { _ in try await Task.sleep(for: .seconds(100_000)) }
        )
    }

    /// A fix `metres` north of the harness origin at the clock's time.
    func fix(north metres: Double) -> LocationFix {
        LocationFix(timestamp: clock.now(), lat: 54.9 + metres / 111_195, lon: 23.9, hAcc: 8, speed: 1.4)
    }

    /// Waits until `condition` holds (the view model reacts to actor streams asynchronously).
    func wait(_ condition: @MainActor () -> Bool) async {
        for _ in 0..<400 where !condition() {
            try? await Task.sleep(for: .milliseconds(5))
        }
    }
}
