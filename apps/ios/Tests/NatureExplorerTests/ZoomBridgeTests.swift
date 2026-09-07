import DesignSystem
import TerritoryRules
import XCTest

/// Proves the app target links the rules package and the shell has its six tabs.
final class ZoomBridgeTests: XCTestCase {
    func testResolutionForZoomFromTerritoryRules() {
        XCTAssertEqual(resolutionForZoom(12), 7, "map initial zoom 12 → res 7")
        XCTAssertEqual(resolutionForZoom(16), 9)
        XCTAssertEqual(resolutionForZoom(0), 1)
        XCTAssertEqual(Rules.res, 9)
    }

    func testSixTabs() {
        XCTAssertEqual(AppTab.allCases.map(\.title), ["Map", "Walk", "Capture", "Collection", "Factions", "Profile"])
    }
}
