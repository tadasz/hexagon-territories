import Core
import CoreTestSupport
import XCTest

/// The `RootView` gate (research.md R12): signed out → sign-in; no faction → pick; else tabs.
final class SessionGateTests: XCTestCase {
    func testRestoringShowsLoading() {
        XCTAssertEqual(SessionGate.decide(session: .signedOut, me: nil, isRestoring: true), .loading)
    }

    func testSignedOutShowsSignIn() {
        XCTAssertEqual(SessionGate.decide(session: .signedOut, me: nil, isRestoring: false), .signIn)
        XCTAssertEqual(SessionGate.decide(session: .signedOut, me: Fixtures.me(), isRestoring: false), .signIn)
    }

    func testSignedInWithoutProfileIsLoading() {
        XCTAssertEqual(SessionGate.decide(session: .signedIn(Fixtures.tokenPair()), me: nil, isRestoring: false), .loading)
    }

    func testSignedInWithoutFactionShowsPick() {
        let me = Fixtures.me(factionId: nil)
        XCTAssertEqual(SessionGate.decide(session: .signedIn(Fixtures.tokenPair()), me: me, isRestoring: false), .factionPick)
        XCTAssertEqual(SessionGate.decide(session: .refreshing, me: me, isRestoring: false), .factionPick)
    }

    func testSignedInWithFactionShowsTabs() {
        XCTAssertEqual(SessionGate.decide(session: .signedIn(Fixtures.tokenPair()), me: Fixtures.me(), isRestoring: false), .tabs)
        XCTAssertEqual(SessionGate.decide(session: .refreshing, me: Fixtures.me(), isRestoring: false), .tabs)
    }
}
