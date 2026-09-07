import TerritoryRules
import XCTest

/// `deriveParentOwner` over the `parentCases` of `reckoning-weeks.json` plus the rule's edge cases.
final class ParentsTests: XCTestCase {
    func testFixtureParentCases() throws {
        let fixture = try loadFixture(ReckoningWeeksFixture.self, named: "reckoning-weeks")
        XCTAssertGreaterThanOrEqual(fixture.parentCases.count, 5)
        for testCase in fixture.parentCases {
            XCTAssertEqual(deriveParentOwner(testCase.input.childOwners), testCase.expected.owner, "[\(testCase.id)]")
        }
    }

    func testRuleTable() {
        XCTAssertEqual(deriveParentOwner([1, 1, 1, 2, 2, 3, 3, nil]), 1, "3 of 7 claimed = 42.8 % > 40 %")
        XCTAssertNil(deriveParentOwner([1, 1, 2, 2, nil]), "tie")
        XCTAssertNil(deriveParentOwner([1, nil, nil]), "one claimed child")
        XCTAssertNil(deriveParentOwner([nil, nil]), "no claimed children")
        XCTAssertNil(deriveParentOwner([]), "no children")
        XCTAssertNil(deriveParentOwner([1, 1, 2, 3, 2]), "exactly 40 % is not enough (and it is a tie)")
        XCTAssertNil(deriveParentOwner([1, 1, 2, 2, 3]), "2 of 5 = 40 % is not > 40 %")
        XCTAssertEqual(deriveParentOwner([1, 1, 2, 3, nil, nil, nil]), 1, "2 of 4 claimed = 50 %")
        XCTAssertEqual(deriveParentOwner([2, 2]), 2, "all claimed by one faction")
    }
}
