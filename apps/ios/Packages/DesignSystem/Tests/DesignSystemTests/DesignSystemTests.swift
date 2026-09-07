import DesignSystem
import SwiftUI
import XCTest

final class DesignSystemTests: XCTestCase {
    func testFactionSeedMirror() {
        XCTAssertEqual(Faction.allCases.map(\.id), [1, 2, 3])
        XCTAssertEqual(Faction.allCases.map(\.slug), ["owls", "foxes", "deer"])
        XCTAssertEqual(Faction.owls.palette, FactionPalette(lightHex: "#4CAF50", darkHex: "#2E7D32"))
        XCTAssertEqual(Faction.foxes.palette, FactionPalette(lightHex: "#FFC107", darkHex: "#FFA000"))
        XCTAssertEqual(Faction.deer.palette, FactionPalette(lightHex: "#2196F3", darkHex: "#1976D2"))
        XCTAssertEqual(Faction(rawValue: 2), .foxes)
    }

    func testHexParsing() {
        XCTAssertNotNil(Color(hex: "#4CAF50"))
        XCTAssertNotNil(Color(hex: "4caf50"))
        XCTAssertNil(Color(hex: "#4CAF5"))
        XCTAssertNil(Color(hex: "#GGGGGG"))
        XCTAssertNil(Color(hex: ""))
    }

    func testFiveTabsInOrder() {
        XCTAssertEqual(AppTab.allCases, [.map, .walk, .capture, .collection, .profile])
        XCTAssertEqual(AppTab.allCases.count, 5)
        XCTAssertEqual(Set(AppTab.allCases.map(\.systemImage)).count, 5, "distinct symbols")
    }
}
