import Foundation
import H3Kit

/// Applies the "Walk acceptance" sample table of `docs/territory-rules.md` in the fixed order of plan.md item 4:
/// non-monotonic timestamp (`ts` not after the last accepted sample) → `.nonMonotonic`;
/// `hAcc > 50` → `.accuracy`; `speed` present and `> 5` → `.speed`. Order of input is preserved.
public func acceptSamples(_ samples: [Sample]) -> SampleAcceptance {
    var accepted: [Sample] = []
    var rejected: [RejectedSample] = []
    var lastAcceptedTs: Date?

    for sample in samples {
        if let last = lastAcceptedTs, sample.ts <= last {
            rejected.append(RejectedSample(seq: sample.seq, reason: .nonMonotonic))
            continue
        }
        if sample.hAcc > Rules.maxSampleHAccM {
            rejected.append(RejectedSample(seq: sample.seq, reason: .accuracy))
            continue
        }
        if let speed = sample.speed, speed > Rules.maxSampleSpeedMps {
            rejected.append(RejectedSample(seq: sample.seq, reason: .speed))
            continue
        }
        accepted.append(sample)
        lastAcceptedTs = sample.ts
    }
    return SampleAcceptance(accepted: accepted, rejected: rejected)
}

/// Walk-level flags over the *accepted* samples (plan.md item 5). Flags are reported; samples are never removed.
/// - `teleport`: implied speed between consecutive accepted samples > 8 m/s.
/// - `speed`: median implied speed > 3.5 m/s.
/// - `distance`: total haversine length > 30 000 m or duration > 6 h.
/// - `noSteps`: pedometer steps given, distance > 500 m and `steps / distance < 0.5`.
/// The result is sorted by raw value for deterministic comparison.
public func walkFlags(accepted samples: [Sample], pedometerSteps: Int? = nil) -> [WalkFlag] {
    var flags = Set<WalkFlag>()
    guard samples.count >= 2 else {
        return []
    }

    var impliedSpeeds: [Double] = []
    var distanceM = 0.0
    for index in 1..<samples.count {
        let previous = samples[index - 1]
        let current = samples[index]
        let segment = Geo.distanceMeters(previous.coordinate, current.coordinate)
        distanceM += segment
        let dt = current.ts.timeIntervalSince(previous.ts)
        guard dt > 0 else { continue }
        let speed = segment / dt
        impliedSpeeds.append(speed)
        if speed > Rules.teleportSpeedMps {
            flags.insert(.teleport)
        }
    }

    if let median = median(of: impliedSpeeds), median > Rules.maxWalkMedianSpeedMps {
        flags.insert(.speed)
    }

    let durationS = samples[samples.count - 1].ts.timeIntervalSince(samples[0].ts)
    if distanceM > Rules.maxWalkDistanceM || durationS > Rules.maxWalkDurationS {
        flags.insert(.distance)
    }

    if let steps = pedometerSteps, distanceM > Rules.noStepsMinDistanceM,
       Double(steps) / distanceM < Rules.minStepsPerM {
        flags.insert(.noSteps)
    }

    return flags.sorted()
}

/// Median of the values (mean of the two middle values for an even count); `nil` for an empty list.
func median(of values: [Double]) -> Double? {
    guard !values.isEmpty else { return nil }
    let sorted = values.sorted()
    let middle = sorted.count / 2
    if sorted.count % 2 == 1 {
        return sorted[middle]
    }
    return (sorted[middle - 1] + sorted[middle]) / 2
}
