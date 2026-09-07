import Foundation

// Foundation-only mirrors of the walk resources in `specs/003-walk-tracking/contracts/openapi.yaml`
// (data-model.md §2 and §6). `Codable` through `JSONCoding` (ISO 8601 dates), `Sendable`, `Equatable`.
// The rules-package types (`TerritoryRules.Sample`, `TerritoryRules.WalkFlag`) are mirrored rather than imported so
// `Core` stays free of the H3 C target; `Location` converts between the two by raw value.

/// Walk status as stored by the server (`walk_sessions.status`; `abandoned` is unused in 003).
public enum WalkStatus: String, Codable, Sendable, Equatable {
    case active
    case finished
    case flagged
    case abandoned
}

/// Who finished the walk (`walk_sessions.finish_reason`).
public enum FinishReason: String, Codable, Sendable, Equatable {
    case client
    case autofinish
    case superseded
}

/// Walk-level anti-cheat flags (`docs/territory-rules.md` "Walk acceptance"). Same raw values as `TerritoryRules.WalkFlag`.
public enum WalkFlag: String, Codable, Sendable, Equatable, CaseIterable {
    case teleport
    case speed
    case distance
    case noSteps = "no_steps"

    /// One-line player-facing explanation (spec US2 scenario 4, US4 scenario 4).
    public var explanation: String {
        switch self {
        case .teleport: "an impossible jump between two positions"
        case .speed: "a pace too fast for walking"
        case .distance: "longer than 30 km or 6 hours"
        case .noSteps: "too few steps for the distance"
        }
    }
}

/// Why the server's provisional filter dropped a sample (`RejectedSample.reason`).
public enum SampleRejectReason: String, Codable, Sendable, Equatable {
    case accuracy
    case speed
    case nonMonotonic = "non_monotonic"
}

/// `LocationSample` of the contract (plan.md Shared Semantics 1): one kept fix of a walk.
public struct LocationSample: Codable, Sendable, Equatable {
    public var seq: Int
    public var ts: Date
    public var lat: Double
    public var lon: Double
    public var hAcc: Double
    public var speed: Double?
    public var course: Double?
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
}

/// `deviceInfo` of `WalkCreateRequest` (strings are truncated to the contract's limits on encoding).
public struct DeviceInfo: Codable, Sendable, Equatable {
    public var model: String?
    public var osVersion: String?
    public var appVersion: String?

    public init(model: String? = nil, osVersion: String? = nil, appVersion: String? = nil) {
        self.model = model.map { String($0.prefix(64)) }
        self.osVersion = osVersion.map { String($0.prefix(32)) }
        self.appVersion = appVersion.map { String($0.prefix(32)) }
    }
}

public struct WalkCreateRequest: Codable, Sendable, Equatable {
    public var clientWalkId: String
    public var startedAt: Date
    public var deviceInfo: DeviceInfo?

    public init(clientWalkId: String, startedAt: Date, deviceInfo: DeviceInfo? = nil) {
        self.clientWalkId = clientWalkId
        self.startedAt = startedAt
        self.deviceInfo = deviceInfo
    }
}

public struct WalkCreated: Codable, Sendable, Equatable {
    public var walkId: String
    public var clientWalkId: String
    public var startedAt: Date
    public var status: WalkStatus
    public var supersededWalkId: String?

    public init(walkId: String, clientWalkId: String, startedAt: Date, status: WalkStatus = .active, supersededWalkId: String? = nil) {
        self.walkId = walkId
        self.clientWalkId = clientWalkId
        self.startedAt = startedAt
        self.status = status
        self.supersededWalkId = supersededWalkId
    }
}

public struct PedometerWindow: Codable, Sendable, Equatable {
    public var steps: Int
    public var since: Date
    public var until: Date

    public init(steps: Int, since: Date, until: Date) {
        self.steps = steps
        self.since = since
        self.until = until
    }
}

public struct SampleBatchRequest: Codable, Sendable, Equatable {
    /// The contract's `maxItems`.
    public static let maxSamples = 200

    public var samples: [LocationSample]
    public var pedometer: PedometerWindow?

    public init(samples: [LocationSample], pedometer: PedometerWindow? = nil) {
        self.samples = samples
        self.pedometer = pedometer
    }
}

public struct RejectedSampleDTO: Codable, Sendable, Equatable {
    public var seq: Int
    public var reason: SampleRejectReason

    public init(seq: Int, reason: SampleRejectReason) {
        self.seq = seq
        self.reason = reason
    }
}

public struct SampleBatchResult: Codable, Sendable, Equatable {
    public var stored: Int
    public var duplicates: Int
    public var accepted: [Int]
    public var rejected: [RejectedSampleDTO]
    public var sampleCount: Int

    public init(stored: Int, duplicates: Int, accepted: [Int], rejected: [RejectedSampleDTO], sampleCount: Int) {
        self.stored = stored
        self.duplicates = duplicates
        self.accepted = accepted
        self.rejected = rejected
        self.sampleCount = sampleCount
    }
}

public struct WalkFinishRequest: Codable, Sendable, Equatable {
    public var endedAt: Date
    public var pedometerTotal: Int?

    public init(endedAt: Date, pedometerTotal: Int? = nil) {
        self.endedAt = endedAt
        self.pedometerTotal = pedometerTotal
    }
}

/// Read model of a cell for this week (research.md R8). Informational only; never changes ownership.
public struct WeekStanding: Codable, Sendable, Equatable {
    public var leader: Int?
    public var myFactionShare: Double
    public var owner: Int?

    public init(leader: Int?, myFactionShare: Double, owner: Int?) {
        self.leader = leader
        self.myFactionShare = myFactionShare
        self.owner = owner
    }
}

public struct WalkHex: Codable, Sendable, Equatable {
    public var h3: String
    public var meters: Double
    public var cappedMeters: Double
    public var weekStanding: WeekStanding

    public init(h3: String, meters: Double, cappedMeters: Double, weekStanding: WeekStanding) {
        self.h3 = h3
        self.meters = meters
        self.cappedMeters = cappedMeters
        self.weekStanding = weekStanding
    }
}

/// GeoJSON `LineString`; positions are `[lon, lat]`.
public struct LineString: Codable, Sendable, Equatable {
    public var type: String
    public var coordinates: [[Double]]

    public init(coordinates: [[Double]]) {
        type = "LineString"
        self.coordinates = coordinates
    }

    /// `(lat, lon)` pairs in path order (positions with fewer than two numbers are skipped).
    public var latLonPairs: [(lat: Double, lon: Double)] {
        coordinates.compactMap { $0.count >= 2 ? (lat: $0[1], lon: $0[0]) : nil }
    }
}

/// The authoritative answer of `POST /v1/walks/{id}/finish` and `GET /v1/walks/{id}` (data-model.md §2.4).
public struct WalkSummary: Codable, Sendable, Equatable, Identifiable {
    public var walkId: String
    public var clientWalkId: String
    public var status: WalkStatus
    public var finishReason: FinishReason?
    public var startedAt: Date
    public var endedAt: Date?
    public var finishedAt: Date?
    public var weekId: String?
    public var distanceM: Double
    public var durationS: Int
    public var steps: Int?
    public var sampleCount: Int
    public var hexCount: Int
    public var xp: Int
    public var scored: Bool
    public var flags: [WalkFlag]
    public var hexes: [WalkHex]
    public var path: LineString?

    public var id: String { walkId }

    public init(
        walkId: String,
        clientWalkId: String,
        status: WalkStatus,
        finishReason: FinishReason?,
        startedAt: Date,
        endedAt: Date?,
        finishedAt: Date?,
        weekId: String?,
        distanceM: Double,
        durationS: Int,
        steps: Int?,
        sampleCount: Int,
        hexCount: Int,
        xp: Int,
        scored: Bool,
        flags: [WalkFlag],
        hexes: [WalkHex],
        path: LineString?
    ) {
        self.walkId = walkId
        self.clientWalkId = clientWalkId
        self.status = status
        self.finishReason = finishReason
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.finishedAt = finishedAt
        self.weekId = weekId
        self.distanceM = distanceM
        self.durationS = durationS
        self.steps = steps
        self.sampleCount = sampleCount
        self.hexCount = hexCount
        self.xp = xp
        self.scored = scored
        self.flags = flags
        self.hexes = hexes
        self.path = path
    }

    public var isFlagged: Bool { status == .flagged || !flags.isEmpty }

    /// The list-row projection of this summary.
    public var listItem: WalkListItem {
        WalkListItem(
            walkId: walkId,
            clientWalkId: clientWalkId,
            status: status,
            finishReason: finishReason,
            startedAt: startedAt,
            endedAt: endedAt,
            weekId: weekId,
            distanceM: distanceM,
            durationS: durationS,
            hexCount: hexCount,
            xp: xp,
            scored: scored,
            flags: flags
        )
    }
}

/// `WalkSummary` without `hexes`, `path`, `finishedAt`, `steps` and `sampleCount` (`GET /v1/walks`).
public struct WalkListItem: Codable, Sendable, Equatable, Identifiable {
    public var walkId: String
    public var clientWalkId: String
    public var status: WalkStatus
    public var finishReason: FinishReason?
    public var startedAt: Date
    public var endedAt: Date?
    public var weekId: String?
    public var distanceM: Double
    public var durationS: Int
    public var hexCount: Int
    public var xp: Int
    public var scored: Bool
    public var flags: [WalkFlag]

    public var id: String { walkId }

    public init(
        walkId: String,
        clientWalkId: String,
        status: WalkStatus,
        finishReason: FinishReason?,
        startedAt: Date,
        endedAt: Date?,
        weekId: String?,
        distanceM: Double,
        durationS: Int,
        hexCount: Int,
        xp: Int,
        scored: Bool,
        flags: [WalkFlag]
    ) {
        self.walkId = walkId
        self.clientWalkId = clientWalkId
        self.status = status
        self.finishReason = finishReason
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.weekId = weekId
        self.distanceM = distanceM
        self.durationS = durationS
        self.hexCount = hexCount
        self.xp = xp
        self.scored = scored
        self.flags = flags
    }
}

public struct WalkListPage: Codable, Sendable, Equatable {
    public var items: [WalkListItem]
    public var nextCursor: String?

    public init(items: [WalkListItem], nextCursor: String?) {
        self.items = items
        self.nextCursor = nextCursor
    }
}
