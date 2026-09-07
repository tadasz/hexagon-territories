import Foundation
import H3Kit
import TerritoryRules

/// Turns raw fixes into the samples that are stored and uploaded (plan.md Shared Semantics 2, research.md R16):
///
/// 1. **Throttle** — a fix is kept only when at least `minIntervalS` passed since the last *kept* fix or it moved at
///    least `minDistanceM` from it. Throttled fixes are dropped silently and consume no `seq`.
/// 2. **Filter** — `acceptSamples` evaluated incrementally: the candidate is judged against the last *accepted*
///    sample (non-monotonic timestamp, `hAcc > 50`, `speed > 5`), exactly like the server over the whole list.
/// 3. **Sequence** — every kept sample gets the next `seq` (0-based), accepted and rejected alike.
public struct PathRecorder: Sendable {
    public struct Throttle: Sendable, Equatable {
        public var minIntervalS: TimeInterval
        public var minDistanceM: Double

        public init(minIntervalS: TimeInterval, minDistanceM: Double) {
            self.minIntervalS = minIntervalS
            self.minDistanceM = minDistanceM
        }

        /// ~1 sample per 5 s or 10 m (`docs/architecture.md` §4 step 2).
        public static let standard = Throttle(minIntervalS: 5, minDistanceM: 10)
        /// Keep every fix (fixture parity tests).
        public static let disabled = Throttle(minIntervalS: 0, minDistanceM: 0)
    }

    public let throttle: Throttle
    public private(set) var nextSeq = 0
    public private(set) var lastAccepted: Sample?
    private var lastKept: (timestamp: Date, coordinate: LatLng)?

    public init(throttle: Throttle = .standard) {
        self.throttle = throttle
    }

    /// The kept sample with its verdict, or `nil` when the fix was throttled.
    public mutating func record(_ fix: LocationFix) -> RecordedSample? {
        if let lastKept {
            let elapsed = fix.timestamp.timeIntervalSince(lastKept.timestamp)
            let moved = Geo.distanceMeters(lastKept.coordinate, fix.coordinate)
            guard elapsed >= throttle.minIntervalS || moved >= throttle.minDistanceM else {
                return nil
            }
        }
        let sample = Sample(
            seq: nextSeq,
            ts: fix.timestamp,
            lat: fix.lat,
            lon: fix.lon,
            hAcc: fix.hAcc,
            speed: fix.speed,
            course: fix.course,
            alt: fix.alt
        )
        nextSeq += 1
        lastKept = (fix.timestamp, fix.coordinate)

        let verdict = acceptSamples(lastAccepted.map { [$0, sample] } ?? [sample])
        if verdict.accepted.contains(where: { $0.seq == sample.seq }) {
            lastAccepted = sample
            return RecordedSample(sample: sample, accepted: true, reason: nil, isStationary: fix.isStationary)
        }
        let reason = verdict.rejected.first { $0.seq == sample.seq }?.reason
        return RecordedSample(sample: sample, accepted: false, reason: reason, isStationary: fix.isStationary)
    }

    /// Continues numbering after `seq` with `lastAccepted` as the filter's reference (recovery of a live walk).
    public mutating func resume(afterSeq seq: Int, lastAccepted: Sample?) {
        nextSeq = seq + 1
        self.lastAccepted = lastAccepted
        lastKept = lastAccepted.map { ($0.ts, $0.coordinate) }
    }
}
