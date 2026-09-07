import CH3

/// A WGS84 coordinate in decimal degrees (`lat` in [-90, 90], `lon` in [-180, 180]).
/// The C library works in radians; conversion happens at the wrapper boundary.
public struct LatLng: Hashable, Sendable, Codable {
    public var lat: Double
    public var lon: Double

    public init(lat: Double, lon: Double) {
        self.lat = lat
        self.lon = lon
    }

    /// Converts from the C library's radian struct.
    init(c value: CH3.LatLng) {
        self.init(lat: radsToDegs(value.lat), lon: radsToDegs(value.lng))
    }

    /// The C library's radian struct for this coordinate.
    var cValue: CH3.LatLng {
        CH3.LatLng(lat: degsToRads(lat), lng: degsToRads(lon))
    }
}
