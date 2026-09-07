import Foundation

/// Why a location source could not start or stopped delivering.
public enum LocationSourceError: Error, Equatable, Sendable {
    /// When-In-Use authorisation is missing (the app never asks for Always — Constitution VII).
    case notAuthorized
    /// Location services are off or the hardware is unavailable.
    case unavailable(String)
}

/// A stream of position fixes for one walk. `start()` acquires whatever the platform needs for background delivery
/// (a `CLBackgroundActivitySession` on iOS); `updates()` yields fixes until `stop()` or a failure; `stop()` releases
/// the session. The tracker calls them in exactly that order, once per walk.
public protocol LocationSource: Sendable {
    func start() throws
    func updates() -> AsyncThrowingStream<LocationFix, any Error>
    func stop()
}

/// The pedometer, when available (`CMPedometer` on device; `nil` steps in the simulator or without motion permission).
public protocol PedometerSource: Sendable {
    /// Steps counted between the two instants, or `nil` when the pedometer cannot answer.
    func steps(from start: Date, to end: Date) async -> Int?
}

/// Authorisation as the app sees it (`CLAuthorizationStatus` without the platform type).
public enum LocationAuthorization: String, Sendable, Equatable {
    case notDetermined
    case whenInUse
    case always
    case denied
    case restricted

    /// Enough for a walk: When-In-Use (or Always, if the player granted it elsewhere; never requested by the app).
    public var allowsWalk: Bool {
        self == .whenInUse || self == .always
    }
}

/// Permission gate used by the walk screen before a walk starts (spec US1 scenario 6): asks for When-In-Use once,
/// reports denied/restricted so the screen can point at Settings. Implemented by `CoreLocationPermission` on iOS.
public protocol LocationPermission: Sendable {
    func status() -> LocationAuthorization
    /// Requests When-In-Use if not determined yet and returns the resulting status.
    func requestWhenInUse() async -> LocationAuthorization
}
