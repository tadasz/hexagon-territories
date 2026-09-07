import CoreTestSupport
import Foundation
import Location

/// Scriptable `LocationSource`: `send` pushes fixes into the stream the tracker consumes, `end(throwing:)` ends it.
/// `startError` makes `start()` fail (permission tests). Records `startCalls` / `stopCalls`.
public final class FakeLocationSource: LocationSource, @unchecked Sendable {
    private struct State {
        var startError: LocationSourceError?
        var startCalls = 0
        var stopCalls = 0
        var continuation: AsyncThrowingStream<LocationFix, any Error>.Continuation?
        var buffered: [LocationFix] = []
    }

    private let state = Locked(State())

    public init() {}

    public var startError: LocationSourceError? {
        get { state.value.startError }
        set { state.withLock { $0.startError = newValue } }
    }

    public var startCalls: Int { state.value.startCalls }
    public var stopCalls: Int { state.value.stopCalls }

    public func start() throws {
        let error = state.withLock { state -> LocationSourceError? in
            state.startCalls += 1
            return state.startError
        }
        if let error { throw error }
    }

    public func updates() -> AsyncThrowingStream<LocationFix, any Error> {
        AsyncThrowingStream { continuation in
            let buffered = state.withLock { state -> [LocationFix] in
                state.continuation = continuation
                let pending = state.buffered
                state.buffered = []
                return pending
            }
            buffered.forEach { continuation.yield($0) }
        }
    }

    public func stop() {
        state.withLock {
            $0.stopCalls += 1
            $0.continuation?.finish()
            $0.continuation = nil
        }
    }

    /// Delivers a fix through the stream (asynchronously consumed by the tracker's task).
    public func send(_ fix: LocationFix) {
        state.withLock { state in
            if let continuation = state.continuation {
                continuation.yield(fix)
            } else {
                state.buffered.append(fix)
            }
        }
    }

    /// Ends the stream, optionally with an error (permission revoked mid-walk).
    public func end(throwing error: (any Error)? = nil) {
        state.withLock { state in
            state.continuation?.finish(throwing: error)
            state.continuation = nil
        }
    }
}

/// Fixed step count.
public struct FakePedometer: PedometerSource {
    public var steps: Int?

    public init(steps: Int?) {
        self.steps = steps
    }

    public func steps(from start: Date, to end: Date) async -> Int? { steps }
}

/// `LocationPermission` with a scripted status.
public final class FakeLocationPermission: LocationPermission, @unchecked Sendable {
    private let state: Locked<(status: LocationAuthorization, afterRequest: LocationAuthorization, requests: Int)>

    public init(status: LocationAuthorization = .whenInUse, afterRequest: LocationAuthorization = .whenInUse) {
        state = Locked((status: status, afterRequest: afterRequest, requests: 0))
    }

    public var requests: Int { state.value.requests }

    public func status() -> LocationAuthorization { state.value.status }

    public func requestWhenInUse() async -> LocationAuthorization {
        state.withLock { state -> LocationAuthorization in
            state.requests += 1
            if state.status == .notDetermined { state.status = state.afterRequest }
            return state.status
        }
    }
}
