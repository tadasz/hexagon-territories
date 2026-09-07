import Foundation
import H3Kit
import TerritoryRules

/// Auto-pause (plan.md Shared Semantics 11): paused after `pauseAfterS` without an accepted sample at least
/// `minMoveM` from the last "anchor" point; resumed by the first such sample. Moving time accumulates only while not
/// paused (up to the moment the pause is detected) and is what the HUD shows as duration.
public struct AutoPauseDetector: Sendable, Equatable {
    public enum Transition: Sendable, Equatable {
        case paused
        case resumed
    }

    public static let defaultPauseAfterS: TimeInterval = 180
    public static let defaultMinMoveM = 10.0

    public let pauseAfterS: TimeInterval
    public let minMoveM: Double
    public private(set) var isPaused = false
    public private(set) var movingSeconds: TimeInterval = 0
    private var anchor: LatLng?
    private var lastMovementAt: Date?
    private var lastTickAt: Date?

    public init(pauseAfterS: TimeInterval = AutoPauseDetector.defaultPauseAfterS, minMoveM: Double = AutoPauseDetector.defaultMinMoveM) {
        self.pauseAfterS = pauseAfterS
        self.minMoveM = minMoveM
    }

    /// Starts the moving clock; "no movement" is counted from here until the first accepted sample.
    public mutating func start(at now: Date, movingSeconds: TimeInterval = 0) {
        isPaused = false
        self.movingSeconds = movingSeconds
        anchor = nil
        lastMovementAt = now
        lastTickAt = now
    }

    /// An accepted sample arrived. `isStationary` is the system's hint; it never resets the movement clock.
    public mutating func observe(_ point: LatLng, at now: Date, isStationary: Bool = false) -> Transition? {
        var transition: Transition?
        if let anchor {
            if Geo.distanceMeters(anchor, point) >= minMoveM {
                self.anchor = point
                lastMovementAt = now
                if isPaused {
                    isPaused = false
                    lastTickAt = now
                    transition = .resumed
                }
            }
        } else {
            anchor = point
            lastMovementAt = now
        }
        return transition ?? tick(now: now)
    }

    /// Time passed without a sample (called on every fix and periodically by the tracker). Moving time is credited
    /// only up to the pause deadline (`lastMovementAt + pauseAfterS`), so the result does not depend on how often
    /// ticks arrive.
    public mutating func tick(now: Date) -> Transition? {
        guard let previousTick = lastTickAt else { return nil }
        let deadline = lastMovementAt.map { $0.addingTimeInterval(pauseAfterS) }
        if !isPaused {
            let creditedUntil = deadline.map { min($0, now) } ?? now
            movingSeconds += max(0, creditedUntil.timeIntervalSince(previousTick))
        }
        lastTickAt = now
        if !isPaused, let deadline, now >= deadline {
            isPaused = true
            return .paused
        }
        return nil
    }
}
