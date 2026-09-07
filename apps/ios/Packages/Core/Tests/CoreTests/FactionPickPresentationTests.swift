import Core
import CoreTestSupport
import Foundation
import XCTest

final class FactionPickPresentationTests: XCTestCase {
    func testRowsFlagSuggestedAndCurrent() {
        let rows = FactionPickPresentation.rows(response: Fixtures.factionsResponse(), me: Fixtures.me(factionId: 1))
        XCTAssertEqual(rows.map(\.id), [1, 2, 3])
        XCTAssertEqual(rows.map(\.isSuggested), [false, false, true])
        XCTAssertEqual(rows.map(\.isCurrent), [true, false, false])
        XCTAssertEqual(rows[2].faction.emoji, "🦌")
    }

    func testRowsWithoutProfileHaveNoCurrent() {
        let rows = FactionPickPresentation.rows(response: Fixtures.factionsResponse(), me: nil)
        XCTAssertFalse(rows.contains(where: \.isCurrent))
    }

    func testRowsSortBySortThenId() {
        var response = Fixtures.factionsResponse()
        response.factions[0].sort = 2 // Owls (id 1) ties with Foxes (id 2) on sort 2 → id decides
        response.factions[2].sort = 1
        response.factions.reverse()
        let rows = FactionPickPresentation.rows(response: response, me: nil)
        XCTAssertEqual(rows.map(\.id), [3, 1, 2])
    }

    func testPreselectionIsCurrentElseSuggested() {
        let response = Fixtures.factionsResponse()
        XCTAssertEqual(FactionPickPresentation.preselectedFactionId(response: response, me: nil), 3)
        XCTAssertEqual(
            FactionPickPresentation.preselectedFactionId(response: response, me: Fixtures.me(factionId: nil)), 3
        )
        XCTAssertEqual(FactionPickPresentation.preselectedFactionId(response: response, me: Fixtures.me(factionId: 2)), 2)
    }

    func testConfirmRules() {
        let locked = FactionChangeLock.locked(until: Fixtures.now.addingTimeInterval(86_400))
        XCTAssertFalse(FactionPickPresentation.confirmEnabled(selected: nil, currentFactionId: nil, lock: .free))
        XCTAssertTrue(FactionPickPresentation.confirmEnabled(selected: 3, currentFactionId: nil, lock: .free), "first pick")
        XCTAssertTrue(
            FactionPickPresentation.confirmEnabled(selected: 3, currentFactionId: nil, lock: locked), "first pick is free"
        )
        XCTAssertFalse(FactionPickPresentation.confirmEnabled(selected: 1, currentFactionId: 1, lock: .free), "same faction")
        XCTAssertTrue(FactionPickPresentation.confirmEnabled(selected: 2, currentFactionId: 1, lock: .free))
        XCTAssertFalse(FactionPickPresentation.confirmEnabled(selected: 2, currentFactionId: 1, lock: locked), "locked")
    }

    func testStatsLine() {
        let stats = FactionStats(members: 12, activeMembers: 9, hexesOwnedR9: 40, hexesOwnedR7: 2)
        XCTAssertEqual(
            FactionPickPresentation.statsLine(stats, activeWindowDays: 14),
            "12 members · 9 active (last 14 days) · 40 r9 / 2 r7 hexes"
        )
        XCTAssertEqual(
            FactionPickPresentation.statsLine(.zero, activeWindowDays: 14),
            "0 members · 0 active (last 14 days) · 0 r9 / 0 r7 hexes"
        )
        XCTAssertTrue(FactionPickPresentation.statsLine(
            FactionStats(members: 1, activeMembers: 1, hexesOwnedR9: 0, hexesOwnedR7: 0), activeWindowDays: 14
        ).hasPrefix("1 member ·"))
    }

    func testEmptyWorldSuggestsOwls() {
        let response = Fixtures.factionsResponse(stats: [.zero, .zero, .zero], suggestedFactionId: 1)
        let rows = FactionPickPresentation.rows(response: response, me: nil)
        XCTAssertEqual(rows.first(where: \.isSuggested)?.id, 1)
        XCTAssertEqual(rows.map(\.faction.stats), [.zero, .zero, .zero])
    }
}
