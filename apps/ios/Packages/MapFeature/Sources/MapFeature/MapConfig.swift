import CoreLocation
import Foundation

/// Where the map starts and which style it loads (research.md R9). One configuration value for the style URL keeps
/// a later switch to a self-hosted PMTiles style a one-line change (ADR 0003 addendum).
public struct MapConfig: Hashable, Sendable {
    /// OpenFreeMap "liberty" — the agreed global basemap for light mode (OpenStreetMap data, no API key).
    public static let defaultStyleURL = URL(string: "https://tiles.openfreemap.org/styles/liberty")!
    /// OpenFreeMap "bright" — the dark-mode style; wired to the colour scheme in feature 005.
    public static let darkStyleURL = URL(string: "https://tiles.openfreemap.org/styles/bright")!
    /// Attribution that must stay visible on the map (Constitution III, `docs/licences.md`).
    public static let attribution = "© OpenStreetMap contributors, © OpenFreeMap"
    /// Info.plist key that overrides the style URL (e.g. a self-hosted basemap for a test build).
    public static let styleURLInfoPlistKey = "MAP_STYLE_URL"

    /// Kaunas — the beta test market and initial centre; the play area itself is worldwide.
    public static let kaunasLatitude = 54.8985
    public static let kaunasLongitude = 23.9036
    public static let defaultZoom = 12.0

    public var styleURL: URL
    public var initialCenterLatitude: Double
    public var initialCenterLongitude: Double
    public var initialZoom: Double

    public init(
        styleURL: URL = MapConfig.defaultStyleURL,
        initialCenterLatitude: Double = MapConfig.kaunasLatitude,
        initialCenterLongitude: Double = MapConfig.kaunasLongitude,
        initialZoom: Double = MapConfig.defaultZoom
    ) {
        self.styleURL = styleURL
        self.initialCenterLatitude = initialCenterLatitude
        self.initialCenterLongitude = initialCenterLongitude
        self.initialZoom = initialZoom
    }

    public var initialCenter: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: initialCenterLatitude, longitude: initialCenterLongitude)
    }

    /// Defaults, with `MAP_STYLE_URL` from the bundle's Info.plist overriding the style when present and valid.
    public static func fromBundle(_ bundle: Bundle = .main) -> MapConfig {
        var config = MapConfig()
        if let raw = bundle.object(forInfoDictionaryKey: styleURLInfoPlistKey) as? String,
           let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
           url.scheme != nil {
            config.styleURL = url
        }
        return config
    }
}
