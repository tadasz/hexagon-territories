import Core
import CoreTestSupport
import FactionsFeature
import Foundation
import XCTest

@MainActor
final class FactionsViewModelTests: XCTestCase {
    private var factions: FakeFactionsService!
    private var profile: FakeProfileService!
    private var clock: FakeClock!

    override func setUp() async throws {
        factions = FakeFactionsService()
        profile = FakeProfileService(me: Fixtures.me(factionId: nil))
        clock = FakeClock()
    }

    private func makeViewModel(onMeChanged: @escaping @MainActor @Sendable (Me) -> Void = { _ in }) -> FactionsViewModel {
        FactionsViewModel(factions: factions, profile: profile, clock: clock, onMeChanged: onMeChanged)
    }

    func testSuggestedFactionIsPreselectedAndBadged() async {
        let viewModel = makeViewModel()
        await viewModel.load()
        XCTAssertEqual(viewModel.phase, .loaded)
        XCTAssertEqual(viewModel.selectedFactionId, 3, "Deer has the fewest active players in the fixture")
        XCTAssertEqual(viewModel.rows.map(\.isSuggested), [false, false, true])
        XCTAssertEqual(viewModel.selectedFaction?.name, "Deer")
        XCTAssertEqual(viewModel.activeWindowDays, 14)
        XCTAssertTrue(viewModel.confirmEnabled, "first pick is free")
        XCTAssertNil(viewModel.lockMessage)
    }

    func testConfirmCallsTheServiceWithTheSelectedId() async {
        let received = Locked<Me?>(nil)
        let viewModel = makeViewModel { received.value = $0 }
        await viewModel.load()
        viewModel.select(2)

        let confirmed = await viewModel.confirm()

        XCTAssertTrue(confirmed)
        XCTAssertEqual(profile.selectFactionCalls, [2])
        XCTAssertEqual(viewModel.me?.factionId, 2)
        XCTAssertEqual(received.value?.factionId, 2)
        XCTAssertEqual(viewModel.currentFaction?.slug, "foxes")
        XCTAssertFalse(viewModel.confirmEnabled, "the selection now equals the current faction")
    }

    func testLockedProfileDisablesConfirmAndShowsTheDate() async {
        let until = clock.now().addingTimeInterval(12 * 86_400)
        profile.currentMe = Fixtures.me(factionId: 1, factionChangeAvailableAt: until)
        let viewModel = makeViewModel()
        await viewModel.load()
        XCTAssertEqual(viewModel.selectedFactionId, 1, "current faction pre-selected")
        viewModel.select(3)
        XCTAssertFalse(viewModel.confirmEnabled)
        XCTAssertEqual(viewModel.lock, .locked(until: until))
        let message = viewModel.lockMessage ?? ""
        XCTAssertTrue(message.contains("12 days"), message)
        XCTAssertTrue(message.contains("2026"), message)
        let confirmed = await viewModel.confirm()
        XCTAssertFalse(confirmed)
        XCTAssertTrue(profile.selectFactionCalls.isEmpty, "a locked change never reaches the API")
    }

    func testServerLockAnswerIsAdopted() async {
        profile.currentMe = Fixtures.me(factionId: 1)
        let nextChangeAt = clock.now().addingTimeInterval(20 * 86_400)
        profile.selectFactionResult = .failure(APIError.factionChangeLocked(nextChangeAt: nextChangeAt))
        let viewModel = makeViewModel()
        await viewModel.load()
        viewModel.select(2)

        let confirmed = await viewModel.confirm()

        XCTAssertFalse(confirmed)
        XCTAssertEqual(viewModel.lock, .locked(until: nextChangeAt))
        XCTAssertFalse(viewModel.confirmEnabled)
        XCTAssertTrue(viewModel.errorMessage?.contains("20 days") ?? false, viewModel.errorMessage ?? "nil")
    }

    func testEmptyWorldShowsZeros() async {
        factions.result = .success(Fixtures.factionsResponse(stats: [.zero, .zero, .zero], suggestedFactionId: 1))
        let viewModel = makeViewModel()
        await viewModel.load()
        XCTAssertEqual(viewModel.selectedFactionId, 1)
        XCTAssertEqual(viewModel.rows.map(\.faction.stats), [.zero, .zero, .zero])
        XCTAssertEqual(viewModel.rows.first(where: \.isSuggested)?.faction.name, "Owls")
    }

    func testFactionsFailureIsReported() async {
        factions.result = .failure(OfflineError())
        let viewModel = makeViewModel()
        await viewModel.load()
        XCTAssertEqual(viewModel.phase, .failed(message: Fixtures.offline.userMessage))
        XCTAssertTrue(viewModel.rows.isEmpty)
    }

    func testProfileFailureKeepsInjectedProfile() async {
        profile.meError = OfflineError()
        let injected = Fixtures.me(factionId: 2)
        let viewModel = FactionsViewModel(factions: factions, profile: profile, clock: clock, me: injected)
        await viewModel.load()
        XCTAssertEqual(viewModel.phase, .loaded)
        XCTAssertEqual(viewModel.me, injected)
        XCTAssertEqual(viewModel.selectedFactionId, 2)
    }

    func testOtherErrorsShowAMessageAndKeepTheSelection() async {
        profile.selectFactionResult = .failure(APIError.factionNotFound)
        let viewModel = makeViewModel()
        await viewModel.load()
        viewModel.select(2)
        let confirmed = await viewModel.confirm()
        XCTAssertFalse(confirmed)
        XCTAssertEqual(viewModel.errorMessage, APIError.factionNotFound.userMessage)
        XCTAssertEqual(viewModel.selectedFactionId, 2)
        XCTAssertFalse(viewModel.isConfirming)
    }

    func testSelectingAnUnknownIdIsIgnored() async {
        let viewModel = makeViewModel()
        await viewModel.load()
        viewModel.select(99)
        XCTAssertEqual(viewModel.selectedFactionId, 3)
    }
}
