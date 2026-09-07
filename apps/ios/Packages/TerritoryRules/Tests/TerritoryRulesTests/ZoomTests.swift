import TerritoryRules
import XCTest

/// `resolutionForZoom` against `zoom-resolution.json` (19 zoom levels + 4 edge cases) — User Story 1, scenario 4.
final class ZoomTests: XCTestCase {
    func testFixtureCases() throws {
        let fixture = try loadFixture(ZoomResolutionFixture.self, named: "zoom-resolution")
        XCTAssertGreaterThanOrEqual(fixture.cases.count, 23, "expected 19 zoom levels + 4 edge cases")
        for testCase in fixture.cases {
            XCTAssertEqual(
                resolutionForZoom(testCase.input.zoom),
                testCase.expected.resolution,
                "[\(testCase.id)] zoom \(testCase.input.zoom)"
            )
        }
    }

    func testPrototypeTable() {
        // prototype/index.html `zoomToResolution`
        let table: [Int: Int] = [
            18: 9, 17: 9, 16: 9, 15: 8, 14: 8, 13: 7, 12: 7, 11: 6, 10: 6, 9: 5, 8: 5,
            7: 4, 6: 4, 5: 3, 4: 3, 3: 2, 2: 2, 1: 1, 0: 1,
        ]
        for (zoom, resolution) in table {
            XCTAssertEqual(resolutionForZoom(Double(zoom)), resolution, "zoom \(zoom)")
        }
    }

    func testEdges() {
        XCTAssertEqual(resolutionForZoom(-1), 1)
        XCTAssertEqual(resolutionForZoom(18.7), 9)
        XCTAssertEqual(resolutionForZoom(20), 9)
        XCTAssertEqual(resolutionForZoom(13.4), 7)
        XCTAssertEqual(resolutionForZoom(15.999), 8)
        XCTAssertEqual(resolutionForZoom(.infinity), 9)
        XCTAssertEqual(resolutionForZoom(-.infinity), 1)
        XCTAssertEqual(resolutionForZoom(.nan), 1)
    }
}
