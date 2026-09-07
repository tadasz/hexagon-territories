import H3Kit
import TerritoryRules
import XCTest

/// Replays `reckoning-weeks.json` week by week: `applyWeeklyCap` → `reckonWeek`, chaining each week's expected
/// state into the next week's input (data-model.md §1.5). Strengths ±0.01; owners, flipped and events exact.
final class ReckoningTests: XCTestCase {
    private static let strengthTolerance = 0.01

    func testAllCellsAllWeeks() throws {
        let fixture = try loadFixture(ReckoningWeeksFixture.self, named: "reckoning-weeks")
        XCTAssertFalse(fixture.cells.isEmpty)
        for cellCase in fixture.cells {
            try replay(cellCase, weeks: fixture.weeks)
        }
    }

    private func replay(_ cellCase: ReckoningWeeksFixture.CellCase, weeks: [String]) throws {
        let id = cellCase.id
        let cell = try XCTUnwrap(H3Index(string: cellCase.cell), "[\(id)] cell \(cellCase.cell)")
        var owner = cellCase.initial.owner
        var strengths = cellCase.initial.strengths.map { FactionStrength(factionId: $0.factionId, strength: $0.strength) }

        for week in cellCase.weeks {
            let label = "[\(id)/\(week.weekId)]"
            XCTAssertTrue(weeks.contains(week.weekId), "\(label) week id listed in the envelope")

            let capped = applyWeeklyCap(week.contributions.map {
                Contribution(cell: cell, factionId: $0.factionId, userId: $0.userId, meters: $0.meters)
            })
            let cappedByKey = Dictionary(uniqueKeysWithValues: capped.map { ("\($0.factionId)/\($0.userId)", $0.cappedMeters) })
            XCTAssertEqual(capped.count, week.expected.capped.count, "\(label) capped entries")
            for expected in week.expected.capped {
                let key = "\(expected.factionId)/\(expected.userId)"
                XCTAssertEqual(cappedByKey[key] ?? -1, expected.cappedMeters, accuracy: Self.strengthTolerance, "\(label) capped \(key)")
            }

            let input = ReckonInput(
                cell: cell,
                owner: owner,
                strengths: strengths,
                contributions: capped.map { ReckonInput.CappedMeters(factionId: $0.factionId, cappedMeters: $0.cappedMeters) },
                bonuses: week.bonuses.map { ReckonInput.Bonus(factionId: $0.factionId, meters: $0.meters) }
            )
            let result = reckonWeek(input)

            XCTAssertEqual(result.strengths.map(\.factionId), week.expected.strengths.map(\.factionId).sorted(), "\(label) faction set (sorted)")
            let expectedStrength = Dictionary(uniqueKeysWithValues: week.expected.strengths.map { ($0.factionId, $0.strength) })
            for strength in result.strengths {
                XCTAssertEqual(strength.strength, expectedStrength[strength.factionId] ?? -1, accuracy: Self.strengthTolerance, "\(label) strength of faction \(strength.factionId)")
            }
            XCTAssertEqual(result.owner, week.expected.owner, "\(label) owner")
            XCTAssertEqual(result.flipped, week.expected.flipped, "\(label) flipped")
            if let event = week.expected.event {
                XCTAssertEqual(result.event, OwnershipEvent(from: event.from, to: event.to), "\(label) event")
            } else {
                XCTAssertNil(result.event, "\(label) no event")
            }

            // Week N+1 initial is week N expected.
            owner = week.expected.owner
            strengths = week.expected.strengths.map { FactionStrength(factionId: $0.factionId, strength: $0.strength) }
        }
    }

    // MARK: Fixture-independent checks of the ownership table (docs/territory-rules.md "Weekly reckoning")

    private let cell = H3Index(string: "891f40d1a4fffff")!

    private func reckon(owner: Int?, strengths: [Int: Double], capped: [Int: Double] = [:], bonuses: [Int: Double] = [:]) -> ReckonResult {
        reckonWeek(ReckonInput(
            cell: cell,
            owner: owner,
            strengths: strengths.map { FactionStrength(factionId: $0.key, strength: $0.value) },
            contributions: capped.map { ReckonInput.CappedMeters(factionId: $0.key, cappedMeters: $0.value) },
            bonuses: bonuses.map { ReckonInput.Bonus(factionId: $0.key, meters: $0.value) }
        ))
    }

    func testNoFactionReachesMinimum() {
        let result = reckon(owner: nil, strengths: [:], capped: [1: 499.99])
        XCTAssertNil(result.owner)
        XCTAssertFalse(result.flipped)
        XCTAssertNil(result.event)
    }

    func testFirstClaim() {
        let result = reckon(owner: nil, strengths: [:], capped: [1: 500])
        XCTAssertEqual(result.owner, 1)
        XCTAssertTrue(result.flipped)
        XCTAssertEqual(result.event, OwnershipEvent(from: nil, to: 1))
    }

    func testHysteresisHoldsAndBreaks() {
        // incumbent 1: 1000 × 0.5 + 500 = 1000; challenger 2 at 1050 does not flip, 1100 does.
        XCTAssertEqual(reckon(owner: 1, strengths: [1: 1000], capped: [1: 500, 2: 1050]).owner, 1)
        XCTAssertEqual(reckon(owner: 1, strengths: [1: 1000], capped: [1: 500, 2: 1101]).owner, 2)
    }

    func testIncumbentDecaysBelowMinimumWithNoChallenger() {
        let result = reckon(owner: 1, strengths: [1: 800])
        XCTAssertEqual(result.strengths, [FactionStrength(factionId: 1, strength: 400)])
        XCTAssertNil(result.owner)
        XCTAssertTrue(result.flipped)
        XCTAssertEqual(result.event, OwnershipEvent(from: 1, to: nil))
    }

    func testExactTies() {
        XCTAssertEqual(reckon(owner: 1, strengths: [1: 1200, 2: 1200]).owner, 1, "tie at the top keeps the incumbent")
        XCTAssertNil(reckon(owner: nil, strengths: [1: 1200, 2: 1200]).owner, "tie without incumbent is unclaimed")
        XCTAssertEqual(reckon(owner: 1, strengths: [1: 1000], capped: [1: 500, 2: 1200, 3: 1200]).owner, 1, "tied challengers leave the incumbent")
    }

    func testCapAndBonus() {
        let capped = applyWeeklyCap([
            Contribution(cell: cell, factionId: 1, userId: "u1", meters: 2600),
            Contribution(cell: cell, factionId: 1, userId: "u2", meters: 300),
            Contribution(cell: cell, factionId: 1, userId: "u1", meters: 100),
        ])
        XCTAssertEqual(capped.map(\.cappedMeters), [2000, 300])
        XCTAssertEqual(capped.map(\.meters), [2700, 300])
        let result = reckon(owner: nil, strengths: [:], capped: [1: 2300], bonuses: [2: 300])
        XCTAssertEqual(result.strengths, [FactionStrength(factionId: 1, strength: 2300), FactionStrength(factionId: 2, strength: 300)])
        XCTAssertEqual(result.owner, 1)
    }

    func testTinyStrengthsAreDropped() {
        let result = reckon(owner: nil, strengths: [1: 0.001, 2: 0.0019])
        XCTAssertEqual(result.strengths.map(\.factionId), [])
    }
}
