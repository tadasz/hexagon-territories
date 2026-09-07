import Foundation

#if canImport(CoreLocation)
import CoreLocation

/// `LocationSource` over iOS 17's `CLLocationUpdate.liveUpdates(.fitness)` (research.md R16). `start()` checks the
/// authorisation (When-In-Use or Always — the app never requests Always) and opens a `CLBackgroundActivitySession`,
/// which keeps location delivery alive in the background and shows the system indicator for the walk's lifetime;
/// `stop()` invalidates it. Requesting the permission is `CoreLocationPermission`'s job.
public final class CoreLocationSource: LocationSource, @unchecked Sendable {
    private let lock = NSLock()
    private var session: CLBackgroundActivitySession?
    private var task: Task<Void, Never>?

    public init() {}

    public func start() throws {
        let status = CLLocationManager().authorizationStatus
        guard status == .authorizedWhenInUse || status == .authorizedAlways else {
            throw LocationSourceError.notAuthorized
        }
        guard CLLocationManager.locationServicesEnabled() else {
            throw LocationSourceError.unavailable("location services disabled")
        }
        lock.withLock {
            session?.invalidate()
            session = CLBackgroundActivitySession()
        }
    }

    public func updates() -> AsyncThrowingStream<LocationFix, any Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    for try await update in CLLocationUpdate.liveUpdates(.fitness) {
                        try Task.checkCancellation()
                        guard let location = update.location else { continue }
                        continuation.yield(LocationFix(location, isStationary: update.isStationary))
                    }
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            lock.withLock { self.task = task }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    public func stop() {
        lock.withLock {
            task?.cancel()
            task = nil
            session?.invalidate()
            session = nil
        }
    }
}

extension LocationFix {
    /// Negative accuracies mean "invalid" in Core Location: mapped to a value the filter rejects.
    public init(_ location: CLLocation, isStationary: Bool) {
        self.init(
            timestamp: location.timestamp,
            lat: location.coordinate.latitude,
            lon: location.coordinate.longitude,
            hAcc: location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : 10_000,
            speed: location.speed >= 0 ? location.speed : nil,
            course: location.course >= 0 ? location.course : nil,
            alt: location.verticalAccuracy >= 0 ? location.altitude : nil,
            isStationary: isStationary
        )
    }
}

extension LocationAuthorization {
    public init(_ status: CLAuthorizationStatus) {
        switch status {
        case .notDetermined: self = .notDetermined
        case .authorizedWhenInUse: self = .whenInUse
        case .authorizedAlways: self = .always
        case .denied: self = .denied
        case .restricted: self = .restricted
        @unknown default: self = .denied
        }
    }
}

/// `LocationPermission` over `CLLocationManager`: reads the status and asks for When-In-Use once, resuming when the
/// delegate reports the player's answer. Never calls `requestAlwaysAuthorization` (Constitution VII).
public final class CoreLocationPermission: NSObject, LocationPermission, CLLocationManagerDelegate, @unchecked Sendable {
    private let manager = CLLocationManager()
    private let lock = NSLock()
    private var waiters: [CheckedContinuation<LocationAuthorization, Never>] = []

    override public init() {
        super.init()
        manager.delegate = self
    }

    public func status() -> LocationAuthorization {
        LocationAuthorization(manager.authorizationStatus)
    }

    public func requestWhenInUse() async -> LocationAuthorization {
        let current = status()
        guard current == .notDetermined else { return current }
        return await withCheckedContinuation { continuation in
            lock.withLock { waiters.append(continuation) }
            manager.requestWhenInUseAuthorization()
        }
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = LocationAuthorization(manager.authorizationStatus)
        guard status != .notDetermined else { return }
        let waiters = lock.withLock { () -> [CheckedContinuation<LocationAuthorization, Never>] in
            let pending = self.waiters
            self.waiters = []
            return pending
        }
        waiters.forEach { $0.resume(returning: status) }
    }
}
#endif
