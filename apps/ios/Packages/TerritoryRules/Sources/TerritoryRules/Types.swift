import Foundation
import H3Kit

/// A raw location sample as uploaded by the app (data-model.md §2 `Sample`). Optional fields may be absent or `null`.
public struct Sample: Hashable, Sendable, Codable {
    public var seq: Int
    /// Sample timestamp; JSON form is an ISO 8601 string (`2026-09-07T08:00:00Z`).
    public var ts: Date
    public var lat: Double
    public var lon: Double
    /// Horizontal accuracy in metres.
    public var hAcc: Double
    /// Reported speed in m/s, if any.
    public var speed: Double?
    /// Course in degrees, if any.
    public var course: Double?
    /// Altitude in metres, if any.
    public var alt: Double?

    public init(
        seq: Int,
        ts: Date,
        lat: Double,
        lon: Double,
        hAcc: Double,
        speed: Double? = nil,
        course: Double? = nil,
        alt: Double? = nil
    ) {
        self.seq = seq
        self.ts = ts
        self.lat = lat
        self.lon = lon
        self.hAcc = hAcc
        self.speed = speed
        self.course = course
        self.alt = alt
    }

    public var coordinate: LatLng {
        LatLng(lat: lat, lon: lon)
    }

    private enum CodingKeys: String, CodingKey {
        case seq, ts, lat, lon, hAcc, speed, course, alt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        seq = try container.decode(Int.self, forKey: .seq)
        let timestamp = try container.decode(String.self, forKey: .ts)
        guard let date = ISO8601.parse(timestamp) else {
            throw DecodingError.dataCorruptedError(
                forKey: .ts,
                in: container,
                debugDescription: "not an ISO 8601 timestamp: \"\(timestamp)\""
            )
        }
        ts = date
        lat = try container.decode(Double.self, forKey: .lat)
        lon = try container.decode(Double.self, forKey: .lon)
        hAcc = try container.decode(Double.self, forKey: .hAcc)
        speed = try container.decodeIfPresent(Double.self, forKey: .speed)
        course = try container.decodeIfPresent(Double.self, forKey: .course)
        alt = try container.decodeIfPresent(Double.self, forKey: .alt)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(seq, forKey: .seq)
        try container.encode(ISO8601.format(ts), forKey: .ts)
        try container.encode(lat, forKey: .lat)
        try container.encode(lon, forKey: .lon)
        try container.encode(hAcc, forKey: .hAcc)
        try container.encodeIfPresent(speed, forKey: .speed)
        try container.encodeIfPresent(course, forKey: .course)
        try container.encodeIfPresent(alt, forKey: .alt)
    }
}

/// ISO 8601 parsing/formatting shared by `Sample` and `weekIdFor` (Sendable `FormatStyle`s, no formatter objects).
enum ISO8601 {
    static func parse(_ string: String) -> Date? {
        if let date = try? Date(string, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: false)) {
            return date
        }
        return try? Date(string, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true))
    }

    static func format(_ date: Date) -> String {
        date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: false))
    }
}

/// Why `acceptSamples` dropped a sample (data-model.md §2 `RejectReason`).
public enum RejectReason: String, Sendable, Codable, CaseIterable {
    case accuracy
    case speed
    case nonMonotonic = "non_monotonic"
}

public struct RejectedSample: Hashable, Sendable, Codable {
    public var seq: Int
    public var reason: RejectReason

    public init(seq: Int, reason: RejectReason) {
        self.seq = seq
        self.reason = reason
    }
}

/// Result of `acceptSamples`.
public struct SampleAcceptance: Sendable, Equatable {
    public var accepted: [Sample]
    public var rejected: [RejectedSample]

    public init(accepted: [Sample], rejected: [RejectedSample]) {
        self.accepted = accepted
        self.rejected = rejected
    }
}

/// Walk-level anti-cheat flags (data-model.md §2 `WalkFlag`). Flagged walks are excluded from the reckoning.
public enum WalkFlag: String, Sendable, Codable, CaseIterable, Comparable {
    case teleport
    case speed
    case distance
    case noSteps = "no_steps"

    public static func < (lhs: WalkFlag, rhs: WalkFlag) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

/// Metres of path inside one res-9 cell (`pathToHexMeters` output).
public struct HexMeters: Hashable, Sendable, Codable {
    public var cell: H3Index
    public var meters: Double

    public init(cell: H3Index, meters: Double) {
        self.cell = cell
        self.meters = meters
    }
}

/// Raw contribution of one player to one cell in one week (`applyWeeklyCap` input).
public struct Contribution: Hashable, Sendable, Codable {
    public var cell: H3Index
    public var factionId: Int
    public var userId: String
    public var meters: Double

    public init(cell: H3Index, factionId: Int, userId: String, meters: Double) {
        self.cell = cell
        self.factionId = factionId
        self.userId = userId
        self.meters = meters
    }
}

/// Summed and capped contribution per `(cell, factionId, userId)` (`applyWeeklyCap` output).
public struct CappedContribution: Hashable, Sendable, Codable {
    public var cell: H3Index
    public var factionId: Int
    public var userId: String
    /// Sum of raw metres.
    public var meters: Double
    /// `min(meters, Rules.weeklyCapMPerPlayerPerCell)`.
    public var cappedMeters: Double

    public init(cell: H3Index, factionId: Int, userId: String, meters: Double, cappedMeters: Double) {
        self.cell = cell
        self.factionId = factionId
        self.userId = userId
        self.meters = meters
        self.cappedMeters = cappedMeters
    }
}

public struct FactionStrength: Hashable, Sendable, Codable {
    public var factionId: Int
    public var strength: Double

    public init(factionId: Int, strength: Double) {
        self.factionId = factionId
        self.strength = strength
    }
}

/// Everything `reckonWeek` needs for one cell (data-model.md §2 `ReckonInput`).
public struct ReckonInput: Sendable, Equatable {
    public struct CappedMeters: Hashable, Sendable, Codable {
        public var factionId: Int
        public var cappedMeters: Double

        public init(factionId: Int, cappedMeters: Double) {
            self.factionId = factionId
            self.cappedMeters = cappedMeters
        }
    }

    public struct Bonus: Hashable, Sendable, Codable {
        public var factionId: Int
        public var meters: Double

        public init(factionId: Int, meters: Double) {
            self.factionId = factionId
            self.meters = meters
        }
    }

    public var cell: H3Index
    /// Owner decided at the previous reckoning, `nil` when unclaimed.
    public var owner: Int?
    /// Strength per faction after the previous reckoning.
    public var strengths: [FactionStrength]
    /// This week's capped walking metres per faction (already summed over players by `applyWeeklyCap`).
    public var contributions: [CappedMeters]
    /// This week's capture bonuses per faction (never capped by the weekly cap).
    public var bonuses: [Bonus]

    public init(
        cell: H3Index,
        owner: Int?,
        strengths: [FactionStrength],
        contributions: [CappedMeters],
        bonuses: [Bonus]
    ) {
        self.cell = cell
        self.owner = owner
        self.strengths = strengths
        self.contributions = contributions
        self.bonuses = bonuses
    }
}

/// An ownership change (`hex_ownership_events` row).
public struct OwnershipEvent: Hashable, Sendable, Codable {
    public var from: Int?
    public var to: Int?

    public init(from: Int?, to: Int?) {
        self.from = from
        self.to = to
    }
}

/// `reckonWeek` output (data-model.md §2 `ReckonResult`).
public struct ReckonResult: Sendable, Equatable {
    /// New strengths sorted by `factionId`; factions below `Rules.minRetainedStrengthM` are dropped.
    public var strengths: [FactionStrength]
    public var owner: Int?
    public var flipped: Bool
    /// Present only when `flipped`.
    public var event: OwnershipEvent?

    public init(strengths: [FactionStrength], owner: Int?, flipped: Bool, event: OwnershipEvent?) {
        self.strengths = strengths
        self.owner = owner
        self.flipped = flipped
        self.event = event
    }
}
