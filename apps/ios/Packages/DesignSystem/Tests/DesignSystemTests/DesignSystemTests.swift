import DesignSystem
import XCTest
#if canImport(SwiftUI)
import SwiftUI
#endif

final class DesignSystemTests: XCTestCase {
    func testSixTabsInOrder() {
        XCTAssertEqual(AppTab.allCases, [.map, .walk, .capture, .collection, .factions, .profile])
        XCTAssertEqual(AppTab.allCases.count, 6)
        XCTAssertEqual(AppTab.allCases.map(\.title), ["Map", "Walk", "Capture", "Collection", "Factions", "Profile"])
        XCTAssertEqual(AppTab.factions.systemImage, "flag.2.crossed")
        XCTAssertEqual(Set(AppTab.allCases.map(\.systemImage)).count, 6, "distinct symbols")
    }

    #if canImport(SwiftUI)
    func testFactionSeedMirror() {
        XCTAssertEqual(Faction.allCases.map(\.id), [1, 2, 3])
        XCTAssertEqual(Faction.allCases.map(\.slug), ["owls", "foxes", "deer"])
        XCTAssertEqual(Faction.owls.palette, FactionPalette(lightHex: "#4CAF50", darkHex: "#2E7D32"))
        XCTAssertEqual(Faction.foxes.palette, FactionPalette(lightHex: "#FFC107", darkHex: "#FFA000"))
        XCTAssertEqual(Faction.deer.palette, FactionPalette(lightHex: "#2196F3", darkHex: "#1976D2"))
        XCTAssertEqual(Faction(rawValue: 2), .foxes)
    }

    func testServerPaletteFromHexStrings() {
        // Faction cards build the palette from `GET /v1/factions` colours (T024).
        let palette = FactionPalette(lightHex: "#4CAF50", darkHex: "#2E7D32")
        XCTAssertEqual(palette.light, Color(hex: "#4CAF50"))
        XCTAssertEqual(palette.color(for: .dark), Color(hex: "#2E7D32"))
    }

    func testHexParsing() {
        XCTAssertNotNil(Color(hex: "#4CAF50"))
        XCTAssertNotNil(Color(hex: "4caf50"))
        XCTAssertNil(Color(hex: "#4CAF5"))
        XCTAssertNil(Color(hex: "#GGGGGG"))
        XCTAssertNil(Color(hex: ""))
    }
    #endif
}
