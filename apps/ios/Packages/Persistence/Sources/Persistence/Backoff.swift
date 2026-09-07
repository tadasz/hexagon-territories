import Foundation

/// Retry schedule of the outbox (research.md R17): `min(300, 2^attempt)` seconds ± 20 % jitter, from a seeded
/// generator so tests are deterministic. `attempt` counts failures so far (1 after the first failure → ~2 s).
public struct Backoff: Sendable, Equatable {
    public static let maxDelayS: TimeInterval = 300
    public static let jitter = 0.2

    private var generator: SplitMix64

    public init(seed: UInt64 = UInt64(truncatingIfNeeded: Int(Date().timeIntervalSince1970 * 1000))) {
        generator = SplitMix64(seed: seed)
    }

    /// Base delay without jitter.
    public static func baseDelay(attempt: Int) -> TimeInterval {
        let exponent = max(0, min(attempt, 30))
        return min(maxDelayS, pow(2, Double(exponent)))
    }

    /// Delay with jitter for the given attempt.
    public mutating func delay(attempt: Int) -> TimeInterval {
        let base = Self.baseDelay(attempt: attempt)
        let unit = Double(generator.next() >> 11) / Double(1 << 53) // [0, 1)
        return base * (1 - Self.jitter + unit * 2 * Self.jitter)
    }
}

/// Tiny seedable PRNG (SplitMix64), enough for jitter.
struct SplitMix64: RandomNumberGenerator, Sendable, Equatable {
    private var state: UInt64

    init(seed: UInt64) {
        state = seed
    }

    mutating func next() -> UInt64 {
        state &+= 0x9E37_79B9_7F4A_7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58_476D_1CE4_E5B9
        z = (z ^ (z >> 27)) &* 0x94D0_49BB_1331_11EB
        return z ^ (z >> 31)
    }
}
