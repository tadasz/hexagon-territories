import Core
import CoreTestSupport
@testable import NatureExplorer
import XCTest

/// The three gate states with fakes (T025): signed out → sign-in; signed in without a faction → faction pick;
/// signed in with a faction → tabs. Plus the offline launch (cached profile) and the sign-out transition.
@MainActor
final class RootGateTests: XCTestCase {
    private var auth: FakeAuthService!
    private var profile: FakeProfileService!
    private var store: InMemoryTokenStore!

    override func setUp() async throws {
        auth = FakeAuthService()
        profile = FakeProfileService()
        store = InMemoryTokenStore()
    }

    private func makeContainer(cache: ProfileCache = .inMemory()) -> AppContainer {
        AppContainer(
            session: AuthSession(service: auth, store: store, clock: FakeClock()),
            auth: auth,
            factions: FakeFactionsService(),
            profile: profile,
            profileCache: cache
        )
    }

    func testStartsLoadingThenSignedOutShowsSignIn() async {
        let container = makeContainer()
        XCTAssertEqual(container.gate, .loading)
        await container.start()
        XCTAssertEqual(container.gate, .signIn)
        XCTAssertNil(container.me)
        container.stop()
    }

    func testSignedInWithoutFactionShowsFactionPick() async {
        try? store.save(Fixtures.tokenPair())
        profile.currentMe = Fixtures.me(factionId: nil)
        let container = makeContainer()
        await container.start()
        XCTAssertEqual(container.gate, .factionPick)
        XCTAssertEqual(container.sessionState, .signedIn(Fixtures.tokenPair()))
        container.stop()
    }

    func testSignedInWithFactionShowsTabs() async {
        try? store.save(Fixtures.tokenPair())
        profile.currentMe = Fixtures.me(factionId: 2)
        let container = makeContainer()
        await container.start()
        XCTAssertEqual(container.gate, .tabs)
        XCTAssertEqual(container.me?.factionId, 2)
        container.stop()
    }

    func testFactionPickMovesToTabsWhenTheProfileUpdates() async {
        try? store.save(Fixtures.tokenPair())
        profile.currentMe = Fixtures.me(factionId: nil)
        let container = makeContainer()
        await container.start()
        XCTAssertEqual(container.gate, .factionPick)
        container.update(me: Fixtures.me(factionId: 3))
        XCTAssertEqual(container.gate, .tabs)
        container.stop()
    }

    func testOfflineLaunchUsesTheCachedProfile() async {
        try? store.save(Fixtures.tokenPair())
        profile.meError = OfflineError()
        let container = makeContainer(cache: .inMemory(Fixtures.me(factionId: 1)))
        await container.start()
        XCTAssertEqual(container.gate, .tabs, "still signed in without the API")
        XCTAssertNil(container.profileError)
        container.stop()
    }

    func testProfileFailureWithoutCacheOffersRetry() async {
        try? store.save(Fixtures.tokenPair())
        profile.meError = OfflineError()
        let container = makeContainer()
        await container.start()
        XCTAssertEqual(container.gate, .loading)
        XCTAssertEqual(container.profileError, Fixtures.offline.userMessage)
        profile.meError = nil
        await container.loadProfile()
        XCTAssertEqual(container.gate, .tabs)
        container.stop()
    }

    func testSignOutReturnsToSignInAndClearsTheProfile() async throws {
        try? store.save(Fixtures.tokenPair())
        let container = makeContainer()
        await container.start()
        XCTAssertEqual(container.gate, .tabs)
        await container.session.signOut()
        // The mirror is fed by the actor's stream; give the observation task a turn.
        for _ in 0..<50 where container.sessionState != .signedOut {
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertEqual(container.gate, .signIn)
        XCTAssertNil(container.me)
        container.stop()
    }

    func testSignInAdoptsTheProfile() async {
        let container = makeContainer()
        await container.start()
        XCTAssertEqual(container.gate, .signIn)
        guard let result = try? await container.session.signIn(Fixtures.applePayload) else {
            return XCTFail("sign-in failed")
        }
        container.signedIn(result) // what AuthViewModel's onSignedIn callback does
        for _ in 0..<50 where container.sessionState == .signedOut {
            try? await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertEqual(container.sessionState, .signedIn(Fixtures.tokenPair()))
        XCTAssertEqual(container.gate, .factionPick)
        container.stop()
    }
}
