import Core
import CoreTestSupport
import DesignSystem
import Location
import LocationTestSupport
@testable import NatureExplorer
import Persistence
import WalkFeature
import XCTest

/// The container builds the walk graph with fakes, the Walk tab hosts the feature, and the launch housekeeping runs
/// (T024).
@MainActor
final class WalkWiringTests: XCTestCase {
    private func makeContainer(source: FakeLocationSource = FakeLocationSource()) -> AppContainer {
        let auth = FakeAuthService()
        let walks = WalkDependencies.inMemory(
            walksService: FakeWalksService(),
            source: source,
            permission: FakeLocationPermission(status: .whenInUse),
            clock: FakeClock()
        )
        return AppContainer(
            session: AuthSession(service: auth, store: InMemoryTokenStore(), clock: FakeClock()),
            auth: auth,
            factions: FakeFactionsService(),
            profile: FakeProfileService(),
            walks: walks
        )
    }

    func testContainerBuildsTheWalkGraphWithFakes() async throws {
        let container = makeContainer()
        XCTAssertFalse(container.walks.storeIsDurable, "in-memory database for tests")
        let state = await container.walks.tracker.state
        XCTAssertEqual(state, .idle)
        XCTAssertFalse(container.walks.livePath.isRecording)
        XCTAssertEqual(try container.walks.repository.localWalks(limit: 10).count, 0)
        XCTAssertEqual(await container.walks.sync.pendingCount(), 0)
    }

    func testDefaultContainerHasAnOfflineWalkGraph() async {
        let auth = FakeAuthService()
        let container = AppContainer(
            session: AuthSession(service: auth, store: InMemoryTokenStore(), clock: FakeClock()),
            auth: auth,
            factions: FakeFactionsService(),
            profile: FakeProfileService()
        )
        XCTAssertFalse(container.walks.storeIsDurable)
        XCTAssertEqual(container.walks.permission.status(), .restricted, "no location on this host")
    }

    func testResumeWalksFinishesARecordingWalkAndQueuesItsFinish() async throws {
        let container = makeContainer()
        let repository = container.walks.repository
        try repository.createWalk(clientWalkId: "crashed", startedAt: Date().addingTimeInterval(-600))
        await container.resumeWalks()
        let walk = try XCTUnwrap(repository.localWalk(id: "crashed"))
        XCTAssertEqual(walk.status, .finished)
        XCTAssertEqual(walk.finishReason, "recovered")
        XCTAssertEqual(try container.walks.outbox.items(walkId: "crashed").map(\.kind), [.finish], "queued for upload")
    }

    func testWalkTabIsTheThirdTabAndHostsTheFeature() {
        XCTAssertEqual(AppTab.allCases[1], .walk)
        XCTAssertEqual(AppTab.walk.systemImage, "figure.walk")
        XCTAssertTrue(RootView.hostsWalkFeature(for: .walk))
        XCTAssertFalse(RootView.hostsWalkFeature(for: .capture))
    }

    func testInfoPlistDeclaresBackgroundLocationAndUsageStrings() throws {
        let info = Bundle.main.infoDictionary ?? [:]
        XCTAssertEqual(info["UIBackgroundModes"] as? [String], ["location"])
        XCTAssertNotNil(info["NSLocationWhenInUseUsageDescription"])
        XCTAssertNotNil(info["NSMotionUsageDescription"])
        XCTAssertEqual(info["BGTaskSchedulerPermittedIdentifiers"] as? [String], [SyncKicks.backgroundTaskIdentifier])
        XCTAssertNil(info["NSLocationAlwaysAndWhenInUseUsageDescription"], "never Always (Constitution VII)")
    }
}
