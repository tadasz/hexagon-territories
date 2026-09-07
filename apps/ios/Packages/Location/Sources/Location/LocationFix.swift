import Foundation
import H3Kit

/// One raw position fix from the location source, before the device filter and throttle (research.md R16).
/// Mirrors what `CLLocationUpdate` carries; `isStationary` is the system's own hint that the device has stopped.
public struct LocationFix: Sendable, Equatable {
    public var timestamp: Date
    public var lat: Double
    public var lon: Double
    /// Horizontal accuracy in metres (radius); invalid fixes carry a very large value so the filter drops them.
    public var hAcc: Double
    public var speed: Double?
    public var course: Double?
    public var alt: Double?
    public var isStationary: Bool

    public init(
        timestamp: Date,
        lat: Double,
        lon: Double,
        hAcc: Double,
        speed: Double? = nil,
        course: Double? = nil,
        alt: Double? = nil,
        isStationary: Bool = false
    ) {
        self.timestamp = timestamp
        self.lat = lat
        self.lon = lon
        self.hAcc = hAcc
        self.speed = speed
        self.course = course
        self.alt = alt
        self.isStationary = isStationary
    }

    public var coordinate: LatLng { LatLng(lat: lat, lon: lon) }
}
