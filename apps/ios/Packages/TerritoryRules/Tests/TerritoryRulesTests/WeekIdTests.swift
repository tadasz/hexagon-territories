import Foundation
import TerritoryRules
import XCTest

/// `weekIdFor` — ISO weeks in UTC with the Monday 00:00 UTC cutoff. Hand-checked dates (no shared fixture until
/// feature 003 adds `week-ids.json`, research.md R11).
final class WeekIdTests: XCTestCase {
    private func utc(_ iso: String) throws -> Date {
        try Date(iso, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: false))
    }

    func testCutoffAtMondayMidnightUTC() throws {
        XCTAssertEqual(weekIdFor(try utc("2026-09-06T23:59:59Z")), "2026-W36", "Sunday night is still week 36")
        XCTAssertEqual(weekIdFor(try utc("2026-09-07T00:00:00Z")), "2026-W37", "Monday 00:00 UTC starts week 37")
        XCTAssertEqual(weekIdFor(try utc("2026-09-13T23:59:59Z")), "2026-W37")
    }

    func testYearBoundaries() throws {
        XCTAssertEqual(weekIdFor(try utc("2026-01-01T00:00:00Z")), "2026-W01", "2026-01-01 is a Thursday")
        XCTAssertEqual(weekIdFor(try utc("2024-12-30T12:00:00Z")), "2025-W01", "ISO week 1 of 2025 starts 2024-12-30")
        XCTAssertEqual(weekIdFor(try utc("2021-01-03T12:00:00Z")), "2020-W53", "2020 has 53 ISO weeks")
        XCTAssertEqual(weekIdFor(try utc("2027-01-03T12:00:00Z")), "2026-W53", "2026 has 53 ISO weeks")
    }

    func testFormat() throws {
        let id = weekIdFor(try utc("2026-03-02T10:00:00Z"))
        XCTAssertEqual(id.count, 8)
        XCTAssertEqual(id, "2026-W10")
    }
}
