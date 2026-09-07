import Foundation
import MapFeature
import Observation

/// Dependency container: the single place that builds concrete services and hands them to features as protocol-typed
/// values. In 001 it holds only `MapConfig`; later features add persistence, networking, location and ML services.
@MainActor
@Observable
final class AppContainer {
    /// Map style and initial camera, from the bundle's Info.plist (`MAP_STYLE_URL` override) or the defaults.
    var mapConfig: MapConfig

    init(mapConfig: MapConfig = MapConfig.fromBundle()) {
        self.mapConfig = mapConfig
    }
}
