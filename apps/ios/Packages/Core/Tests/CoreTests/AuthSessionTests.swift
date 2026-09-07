import Core
import CoreTestSupport
import Foundation
import XCTest

/// The refresh-on-401 state machine (research.md R12, plan.md Shared Semantics 2–4; T018, SC-008).
final class AuthSessionTests: XCTestCase {
    private var clock: FakeClock!
    private var store: RecordingTokenStore!
    private var service: FakeAuthService!

    override func setUp() {
        super.setUp()
        clock = FakeClock()
        store = RecordingTokenStore()
        service = FakeAuthService()
    }

    private func makeSession(skew: TimeInterval = AuthSession.defaultSkew) -> AuthSession {
        AuthSession(service: service, store: store, clock: clock, skew: skew)
    }

    // MARK: restore

    func testRestoreFromStoreSignsIn() async {
        let pair = Fixtures.tokenPair()
        store.pair = pair
        let session = makeSession()
        let state = await session.restore()
        XCTAssertEqual(state, .signedIn(pair))
        let current = await session.currentTokens
        XCTAssertEqual(current, pair)
        XCTAssertEqual(store.loadCount, 1)
    }

    func testRestoreWithEmptyStoreIsSignedOut() async {
        let session = makeSession()
        let state = await session.restore()
        XCTAssertEqual(state, .signedOut)
    }

    func testRestoreWithCorruptStoreIsSignedOutAndClears() async {
        store.loadError = OfflineError()
        let session = makeSession()
        let state = await session.restore()
        XCTAssertEqual(state, .signedOut)
        XCTAssertEqual(store.clearCount, 1)
    }

    // MARK: sign in

    func testSignInPersistsPairAndEmitsSignedIn() async throws {
        let session = makeSession()
        let result = try await session.signIn(Fixtures.applePayload)
        XCTAssertEqual(result.tokens, Fixtures.tokenPair())
        XCTAssertEqual(store.saved, [Fixtures.tokenPair()])
        XCTAssertEqual(service.signInCalls, [Fixtures.applePayload])
        var emitted: AuthState?
        for await state in session.authStateChanges {
            emitted = state
            break
        }
        XCTAssertEqual(emitted, .signedIn(Fixtures.tokenPair()))
    }

    func testSignInFailureLeavesSignedOut() async {
        service.signInResult = .failure(APIError.invalidAppleToken(reason: "audience"))
        let session = makeSession()
        do {
            _ = try await session.signIn(Fixtures.applePayload)
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? APIError, .invalidAppleToken(reason: "audience"))
        }
        let state = await session.state
        XCTAssertEqual(state, .signedOut)
        XCTAssertTrue(store.saved.isEmpty)
    }

    // MARK: validAccessToken

    func testValidTokenIsReturnedWithoutRefresh() async throws {
        store.pair = Fixtures.tokenPair()
        let session = makeSession()
        await session.restore()
        let token = try await session.validAccessToken()
        XCTAssertEqual(token, "access-1")
        XCTAssertTrue(service.refreshCalls.isEmpty)
    }

    func testSignedOutSessionThrowsUnauthorized() async {
        let session = makeSession()
        do {
            _ = try await session.validAccessToken()
            XCTFail("expected unauthorized")
        } catch {
            XCTAssertEqual(error as? APIError, .unauthorized)
        }
    }

    func testExpiredTokenRefreshesReplacesPairAndPersists() async throws {
        store.pair = Fixtures.tokenPair()
        let fresh = Fixtures.tokenPair(access: "access-2", refresh: "refresh-2", from: clock.now().addingTimeInterval(1_000))
        service.refreshReturning(fresh)
        let session = makeSession()
        await session.restore()
        clock.advance(by: 1_000) // past the 900 s expiry

        let token = try await session.validAccessToken()

        XCTAssertEqual(token, "access-2")
        XCTAssertEqual(service.refreshCalls, ["refresh-1"])
        XCTAssertEqual(store.pair, fresh)
        let state = await session.state
        XCTAssertEqual(state, .signedIn(fresh))
    }

    func testSkewBoundary() async throws {
        // Expires in exactly 30 s → treated as expired (refresh); 31 s → still valid.
        store.pair = Fixtures.tokenPair(accessExpiresIn: 30)
        let session = makeSession()
        await session.restore()
        _ = try await session.validAccessToken()
        XCTAssertEqual(service.refreshCalls.count, 1, "30 s left is inside the skew window")

        store.pair = Fixtures.tokenPair(accessExpiresIn: 31)
        let other = makeSession()
        await other.restore()
        let token = try await other.validAccessToken()
        XCTAssertEqual(token, "access-1")
        XCTAssertEqual(service.refreshCalls.count, 1, "31 s left needs no refresh")
    }

    // MARK: refresh failures

    func testSessionEndingRefreshFailuresSignOutAndClearStore() async {
        for failure in [APIError.unauthorized, .refreshReused, .accountDeleted, .invalidRefreshToken, .tokenExpired] {
            let store = RecordingTokenStore(Fixtures.tokenPair())
            let service = FakeAuthService()
            service.refreshFailing(failure)
            let session = AuthSession(service: service, store: store, clock: clock)
            await session.restore()
            clock.advance(by: 1_000)

            do {
                _ = try await session.validAccessToken()
                XCTFail("expected \(failure)")
            } catch {
                XCTAssertEqual(error as? APIError, failure)
            }
            let state = await session.state
            XCTAssertEqual(state, .signedOut, "\(failure)")
            XCTAssertNil(store.pair, "\(failure)")
            XCTAssertEqual(store.clearCount, 1, "\(failure)")
            clock.advance(by: -1_000)
        }
    }

    func testNetworkErrorKeepsSessionAndRethrows() async {
        store.pair = Fixtures.tokenPair()
        service.refreshFailing(Fixtures.offline)
        let session = makeSession()
        await session.restore()
        clock.advance(by: 1_000)

        do {
            _ = try await session.validAccessToken()
            XCTFail("expected a network error")
        } catch {
            XCTAssertEqual(error as? APIError, Fixtures.offline)
        }
        let state = await session.state
        XCTAssertEqual(state, .signedIn(Fixtures.tokenPair()))
        XCTAssertEqual(store.pair, Fixtures.tokenPair())
        XCTAssertEqual(store.clearCount, 0)
    }

    func testRateLimitKeepsSession() async {
        store.pair = Fixtures.tokenPair()
        service.refreshFailing(APIError.rateLimited(retryAfterS: 5))
        let session = makeSession()
        await session.restore()
        clock.advance(by: 1_000)
        _ = try? await session.validAccessToken()
        let state = await session.state
        XCTAssertEqual(state, .signedIn(Fixtures.tokenPair()))
    }

    // MARK: single flight

    func testConcurrentCallersShareOneRefresh() async throws {
        store.pair = Fixtures.tokenPair()
        let fresh = Fixtures.tokenPair(access: "access-2", refresh: "refresh-2", from: clock.now().addingTimeInterval(1_000))
        service.refreshHandler = { _ in
            try await Task.sleep(for: .milliseconds(80))
            return fresh
        }
        let session = makeSession()
        await session.restore()
        clock.advance(by: 1_000)

        let tokens = try await withThrowingTaskGroup(of: String.self) { group in
            for _ in 0..<10 {
                group.addTask { try await session.validAccessToken() }
            }
            var collected: [String] = []
            for try await token in group { collected.append(token) }
            return collected
        }

        XCTAssertEqual(tokens, Array(repeating: "access-2", count: 10))
        XCTAssertEqual(service.refreshCalls.count, 1, "exactly one refresh for ten concurrent callers")
        XCTAssertEqual(store.saved, [fresh])
    }

    func testStateIsRefreshingWhileInFlight() async throws {
        store.pair = Fixtures.tokenPair()
        service.refreshHandler = { _ in
            try await Task.sleep(for: .milliseconds(80))
            return Fixtures.tokenPair(access: "access-2")
        }
        let session = makeSession()
        await session.restore()
        clock.advance(by: 1_000)
        let refresh = Task { try await session.refresh() }
        try await Task.sleep(for: .milliseconds(20))
        let mid = await session.state
        XCTAssertEqual(mid, .refreshing)
        XCTAssertTrue(mid.isSignedIn, ".refreshing still counts as signed in for the gate")
        _ = try await refresh.value
    }

    // MARK: handleUnauthorized

    func testHandleUnauthorizedRefreshesOnce() async throws {
        store.pair = Fixtures.tokenPair()
        service.refreshReturning(Fixtures.tokenPair(access: "access-2", refresh: "refresh-2"))
        let session = makeSession()
        await session.restore()

        let token = try await session.handleUnauthorized(failedAccessToken: "access-1")
        XCTAssertEqual(token, "access-2")
        XCTAssertEqual(service.refreshCalls, ["refresh-1"])
    }

    func testHandleUnauthorizedWithStaleTokenReturnsCurrentWithoutRefreshing() async throws {
        store.pair = Fixtures.tokenPair(access: "access-2", refresh: "refresh-2")
        let session = makeSession()
        await session.restore()

        let token = try await session.handleUnauthorized(failedAccessToken: "access-1")
        XCTAssertEqual(token, "access-2", "a sibling request already rotated the pair")
        XCTAssertTrue(service.refreshCalls.isEmpty)
    }

    // MARK: sign out

    func testSignOutCallsLogoutAndClearsStore() async {
        store.pair = Fixtures.tokenPair()
        let session = makeSession()
        await session.restore()
        await session.signOut()
        XCTAssertEqual(service.logoutCalls, ["refresh-1"])
        XCTAssertNil(store.pair)
        XCTAssertEqual(store.clearCount, 1)
        let state = await session.state
        XCTAssertEqual(state, .signedOut)
    }

    func testSignOutClearsStoreEvenWhenLogoutThrows() async {
        store.pair = Fixtures.tokenPair()
        service.logoutError = Fixtures.offline
        let session = makeSession()
        await session.restore()
        await session.signOut()
        XCTAssertEqual(service.logoutCalls.count, 1)
        XCTAssertNil(store.pair)
        let state = await session.state
        XCTAssertEqual(state, .signedOut)
    }

    func testClearLocalSessionSkipsLogout() async {
        store.pair = Fixtures.tokenPair()
        let session = makeSession()
        await session.restore()
        await session.clearLocalSession()
        XCTAssertTrue(service.logoutCalls.isEmpty)
        XCTAssertNil(store.pair)
        let state = await session.state
        XCTAssertEqual(state, .signedOut)
    }

    func testSignOutDuringRefreshDoesNotResurrectSession() async throws {
        store.pair = Fixtures.tokenPair()
        service.refreshHandler = { _ in
            try await Task.sleep(for: .milliseconds(80))
            return Fixtures.tokenPair(access: "access-2")
        }
        let session = makeSession()
        await session.restore()
        clock.advance(by: 1_000)
        let refresh = Task { try await session.validAccessToken() }
        try await Task.sleep(for: .milliseconds(20))
        await session.clearLocalSession()
        let result = await refresh.result
        XCTAssertEqual(try? result.get(), nil)
        let state = await session.state
        XCTAssertEqual(state, .signedOut)
        XCTAssertNil(store.pair)
    }
}
