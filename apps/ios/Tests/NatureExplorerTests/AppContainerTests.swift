import Core
import CoreTestSupport
import MapFeature
@testable import NatureExplorer
import XCTest

@MainActor
final class AppContainerTests: XCTestCase {
    private func makeContainer(mapConfig: MapConfig = MapConfig.fromBundle()) -> AppContainer {
        let auth = FakeAuthService()
        return AppContainer(
            session: AuthSession(service: auth, store: InMemoryTokenStore(), clock: FakeClock()),
            auth: auth,
            factions: FakeFactionsService(),
            profile: FakeProfileService(),
            mapConfig: mapConfig
        )
    }

    func testDefaultsPointAtKaunasWithTheLibertyStyle() {
        let container = makeContainer()
        XCTAssertEqual(container.mapConfig.styleURL, MapConfig.defaultStyleURL)
        XCTAssertEqual(container.mapConfig.initialCenterLatitude, 54.8985)
        XCTAssertEqual(container.mapConfig.initialCenterLongitude, 23.9036)
        XCTAssertEqual(container.mapConfig.initialZoom, 12)
    }

    func testInjectedConfigIsUsed() throws {
        let custom = MapConfig(styleURL: try XCTUnwrap(URL(string: "https://example.test/style.json")), initialZoom: 9)
        let container = makeContainer(mapConfig: custom)
        XCTAssertEqual(container.mapConfig, custom)
    }

    func testInfoPlistStyleOverrideMatchesTheDefault() {
        // The app's Info.plist sets MAP_STYLE_URL to the OpenFreeMap liberty style; changing the key there must be
        // reflected here without code changes.
        XCTAssertEqual(MapConfig.fromBundle(.main).styleURL, MapConfig.defaultStyleURL)
    }

    func testInfoPlistAPIBaseURLIsLocalhost() {
        XCTAssertEqual(AppConfig.apiBaseURL(bundle: .main), AppConfig.defaultAPIBaseURL)
        XCTAssertEqual(AppConfig.defaultAPIBaseURL.absoluteString, "http://localhost:3000")
    }

    func testPreviewContainerStartsSignedOut() async {
        let container = AppContainer.preview()
        await container.start()
        XCTAssertEqual(container.gate, .signIn)
        container.stop()
    }
}
