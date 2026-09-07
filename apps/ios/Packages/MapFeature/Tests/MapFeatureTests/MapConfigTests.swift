import Foundation
import MapFeature
import XCTest

final class MapConfigTests: XCTestCase {
    func testDefaultsAreKaunasAtZoom12WithLiberty() {
        let config = MapConfig()
        XCTAssertEqual(config.styleURL.absoluteString, "https://tiles.openfreemap.org/styles/liberty")
        XCTAssertEqual(config.initialCenterLatitude, 54.8985)
        XCTAssertEqual(config.initialCenterLongitude, 23.9036)
        XCTAssertEqual(config.initialZoom, 12)
        XCTAssertEqual(config.initialCenter.latitude, 54.8985)
        XCTAssertEqual(config.initialCenter.longitude, 23.9036)
    }

    func testAttributionText() {
        XCTAssertEqual(MapConfig.attribution, "© OpenStreetMap contributors, © OpenFreeMap")
    }

    func testBundleOverride() {
        let bundle = Bundle(for: MapConfigTests.self)
        // The test bundle carries no MAP_STYLE_URL, so the default applies.
        XCTAssertEqual(MapConfig.fromBundle(bundle).styleURL, MapConfig.defaultStyleURL)
    }
}
