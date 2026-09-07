import Foundation
import H3Kit

/// Spherical helpers shared by the path pipeline (plan.md "Shared Rule Semantics" item 2):
/// haversine on a sphere of radius `Rules.earthRadiusM`, bearing-free linear interpolation in lat/lon.
public enum Geo {
    /// Great-circle distance in metres (haversine, R = 6 371 008.8 m).
    public static func distanceMeters(_ a: LatLng, _ b: LatLng) -> Double {
        let lat1 = a.lat * .pi / 180
        let lat2 = b.lat * .pi / 180
        let dLat = lat2 - lat1
        let dLon = (b.lon - a.lon) * .pi / 180
        let sinLat = sin(dLat / 2)
        let sinLon = sin(dLon / 2)
        let h = sinLat * sinLat + cos(lat1) * cos(lat2) * sinLon * sinLon
        let clamped = min(1, max(0, h))
        return 2 * Rules.earthRadiusM * asin(sqrt(clamped))
    }

    /// Point at fraction `t` (0...1) along the segment, interpolating linearly in latitude and longitude.
    public static func interpolate(_ a: LatLng, _ b: LatLng, t: Double) -> LatLng {
        LatLng(lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t)
    }

    /// Sum of haversine segment lengths along `points`.
    public static func pathLengthMeters(_ points: [LatLng]) -> Double {
        guard points.count > 1 else { return 0 }
        var total = 0.0
        for index in 1..<points.count {
            total += distanceMeters(points[index - 1], points[index])
        }
        return total
    }
}
