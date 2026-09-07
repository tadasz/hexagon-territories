import Core
import CoreTestSupport
import Foundation
import ProfileFeature
import XCTest

@MainActor
final class ProfileViewModelTests: XCTestCase {
    private var profile: FakeProfileService!
    private var auth: FakeAuthService!
    private var store: RecordingTokenStore!
    private var session: AuthSession!
    private var clock: FakeClock!

    override func setUp() async throws {
        profile = FakeProfileService()
        auth = FakeAuthService()
        store = RecordingTokenStore(Fixtures.tokenPair())
        clock = FakeClock()
        session = AuthSession(service: auth, store: store, clock: clock)
        await session.restore()
    }

    private func makeViewModel(
        sleeper: @escaping ProfileViewModel.Sleeper = { _ in },
        onMeChanged: @escaping @MainActor @Sendable (Me?) -> Void = { _ in }
    ) -> ProfileViewModel {
        ProfileViewModel(
            profile: profile,
            factions: FakeFactionsService(),
            session: session,
            clock: clock,
            sleeper: sleeper,
            onMeChanged: onMeChanged
        )
    }

    // MARK: load

    func testLoadFillsProfileAndFaction() async {
        let viewModel = makeViewModel()
        await viewModel.load()
        XCTAssertEqual(viewModel.phase, .loaded)
        XCTAssertEqual(viewModel.me, Fixtures.me())
        XCTAssertEqual(viewModel.currentFaction?.name, "Owls")
    }

    func testLoadFailureWithoutProfileFails() async {
        profile.meError = OfflineError()
        let viewModel = makeViewModel()
        await viewModel.load()
        XCTAssertEqual(viewModel.phase, .failed(message: Fixtures.offline.userMessage))
    }

    // MARK: display name

    func testInvalidNameNeverReachesTheService() async {
        let viewModel = makeViewModel()
        await viewModel.load()
        viewModel.beginEditingName()
        XCTAssertEqual(viewModel.displayNameDraft, "Explorer 4821")
        XCTAssertFalse(viewModel.canSaveDraft, "unchanged name")

        viewModel.displayNameDraft = "A"
        XCTAssertEqual(viewModel.draftError, .tooShort)
        XCTAssertFalse(viewModel.canSaveDraft)
        let saved = await viewModel.saveDisplayName()
        XCTAssertFalse(saved)

        viewModel.displayNameDraft = "Ta\nDas"
        XCTAssertEqual(viewModel.draftError, .controlCharacter)
        viewModel.displayNameDraft = String(repeating: "ž", count: 25)
        XCTAssertEqual(viewModel.draftError, .tooLong)
        XCTAssertEqual(viewModel.draftScalarCount, 25)
        XCTAssertTrue(profile.updateDisplayNameCalls.isEmpty)
    }

    func testValidNameIsTrimmedAndSaved() async {
        let received = Locked<Me?>(nil)
        let viewModel = makeViewModel(onMeChanged: { received.value = $0 })
        await viewModel.load()
        viewModel.displayNameDraft = "  Ąžuolas  "
        XCTAssertNil(viewModel.draftError)
        XCTAssertTrue(viewModel.canSaveDraft)

        let saved = await viewModel.saveDisplayName()

        XCTAssertTrue(saved)
        XCTAssertEqual(profile.updateDisplayNameCalls, ["Ąžuolas"])
        XCTAssertEqual(viewModel.me?.displayName, "Ąžuolas")
        XCTAssertEqual(received.value?.displayName, "Ąžuolas")
    }

    func testServerValidationErrorIsShown() async {
        profile.updateDisplayNameResult = .failure(APIError.validation(message: "body/displayName tooLong"))
        let viewModel = makeViewModel()
        await viewModel.load()
        viewModel.displayNameDraft = "Fine name"
        let saved = await viewModel.saveDisplayName()
        XCTAssertFalse(saved)
        XCTAssertEqual(viewModel.errorMessage, APIError.validation(message: "").userMessage)
    }

    // MARK: sign out / delete

    func testSignOutClearsTheSession() async {
        let received = Locked<Me??>(nil)
        let viewModel = makeViewModel(onMeChanged: { received.value = .some($0) })
        await viewModel.load()
        await viewModel.signOut()
        XCTAssertEqual(auth.logoutCalls, ["refresh-1"])
        XCTAssertNil(store.pair)
        let state = await session.state
        XCTAssertEqual(state, .signedOut)
        XCTAssertEqual(received.value, .some(nil))
    }

    func testDeleteClearsSessionWithoutCallingLogout() async {
        let viewModel = makeViewModel()
        await viewModel.load()
        let deleted = await viewModel.deleteAccount()
        XCTAssertTrue(deleted)
        XCTAssertEqual(profile.deleteAccountCalls, 1)
        XCTAssertNil(store.pair)
        XCTAssertTrue(auth.logoutCalls.isEmpty, "the server already revoked every token")
        let state = await session.state
        XCTAssertEqual(state, .signedOut)
    }

    func testDeleteClearsSessionEvenWhenTheResponseCannotBeRead() async {
        profile.deleteAccountResult = .failure(APIError.unexpected(code: "DECODING", status: 200))
        let viewModel = makeViewModel()
        await viewModel.load()
        let deleted = await viewModel.deleteAccount()
        XCTAssertTrue(deleted)
        XCTAssertNil(store.pair)
        let state = await session.state
        XCTAssertEqual(state, .signedOut)
    }

    func testDeleteKeepsSessionWhenTheRequestNeverArrived() async {
        profile.deleteAccountResult = .failure(Fixtures.offline)
        let viewModel = makeViewModel()
        await viewModel.load()
        let deleted = await viewModel.deleteAccount()
        XCTAssertFalse(deleted)
        XCTAssertEqual(viewModel.errorMessage, Fixtures.offline.userMessage)
        XCTAssertEqual(store.pair, Fixtures.tokenPair())
        let state = await session.state
        XCTAssertEqual(state, .signedIn(Fixtures.tokenPair()))
    }

    // MARK: export

    func testExportPollsUntilReady() async throws {
        profile.exportResults = [
            .success(Fixtures.exportStatus(.pending)),
            .success(Fixtures.exportStatus(.pending)),
            .success(Fixtures.exportStatus(.ready)),
        ]
        let sleeps = Locked([Duration]())
        let clock = self.clock!
        let viewModel = makeViewModel(sleeper: { duration in
            sleeps.withLock { $0.append(duration) }
            clock.advance(by: 5)
        })

        await viewModel.requestExport()

        XCTAssertEqual(profile.exportCalls, 3, "polling stops at ready")
        XCTAssertEqual(sleeps.value, [.seconds(5), .seconds(5)])
        let url = try XCTUnwrap(Fixtures.exportStatus(.ready).downloadURL)
        XCTAssertEqual(viewModel.export, .ready(url: url, expiresAt: Fixtures.exportStatus(.ready).expiresAt))
    }

    func testExportFailureStopsPolling() async {
        profile.exportResults = [
            .success(Fixtures.exportStatus(.pending)),
            .success(Fixtures.exportStatus(.failed, error: "bucket unavailable")),
        ]
        let viewModel = makeViewModel()
        await viewModel.requestExport()
        XCTAssertEqual(profile.exportCalls, 2)
        XCTAssertEqual(viewModel.export, .failed(message: "bucket unavailable"))
    }

    func testExportNetworkErrorIsShown() async {
        profile.exportResults = [.failure(OfflineError())]
        let viewModel = makeViewModel()
        await viewModel.requestExport()
        XCTAssertEqual(viewModel.export, .failed(message: Fixtures.offline.userMessage))
        viewModel.resetExport()
        XCTAssertEqual(viewModel.export, .idle)
    }

    func testExportTimesOutAfterTheBudget() async {
        profile.exportResults = [.success(Fixtures.exportStatus(.pending))]
        let clock = self.clock!
        let viewModel = makeViewModel(sleeper: { _ in clock.advance(by: ExportPresentation.pollInterval) })
        await viewModel.requestExport()
        XCTAssertEqual(viewModel.export, .timedOut)
        XCTAssertEqual(profile.exportCalls, ExportPresentation.maxPolls + 1)
    }
}
