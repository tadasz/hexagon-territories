import Foundation
import H3Kit
import TerritoryRules

/// A fix that passed the throttle, with the device filter's verdict (plan.md Shared Semantics 2). Rejected samples
/// are stored and uploaded too, so the server sees the same input; they are never part of the path.
public struct RecordedSample: Sendable, Equatable {
    public var sample: Sample
    public var accepted: Bool
    public var reason: RejectReason?
    public var isStationary: Bool

    public init(sample: Sample, accepted: Bool, reason: RejectReason?, isStationary: Bool = false) {
        self.sample = sample
        self.accepted = accepted
        self.reason = reason
        self.isStationary = isStationary
    }
}

/// Numbers of a recording walk as persisted between samples (the path itself is rebuilt from the stored samples).
public struct WalkProgress: Sendable, Equatable {
    public var distanceM: Double
    public var movingSeconds: Int
    public var hexCount: Int
    public var isPaused: Bool
    /// Estimated metres per res-9 cell, sorted by cell (the HUD's provisional numbers).
    public var hexEstimates: [HexMeters]
    public var currentCell: H3Index?
    /// Timestamp of the last kept sample (accepted or rejected); the recovery end time.
    public var lastSampleTs: Date?
    public var sampleCount: Int
    public var acceptedCount: Int

    public init(
        distanceM: Double = 0,
        movingSeconds: Int = 0,
        hexCount: Int = 0,
        isPaused: Bool = false,
        hexEstimates: [HexMeters] = [],
        currentCell: H3Index? = nil,
        lastSampleTs: Date? = nil,
        sampleCount: Int = 0,
        acceptedCount: Int = 0
    ) {
        self.distanceM = distanceM
        self.movingSeconds = movingSeconds
        self.hexCount = hexCount
        self.isPaused = isPaused
        self.hexEstimates = hexEstimates
        self.currentCell = currentCell
        self.lastSampleTs = lastSampleTs
        self.sampleCount = sampleCount
        self.acceptedCount = acceptedCount
    }
}

/// What the tracker hands over when a walk ends; the outbox turns it into the finish request and the screen into
/// the provisional summary (data-model.md §6 `ProvisionalSummary`).
public struct WalkFinishInput: Sendable, Equatable {
    public enum Reason: String, Sendable, Equatable {
        /// The player tapped Stop.
        case client
        /// Six hours of recording (plan.md Shared Semantics 11).
        case autoEnd
        /// Found still recording at relaunch (spec US1 scenario 7).
        case recovered
        /// The location source stopped delivering (permission revoked, spec edge case).
        case sourceLost
    }

    public var clientWalkId: String
    public var startedAt: Date
    public var endedAt: Date
    public var reason: Reason
    public var progress: WalkProgress
    /// Pedometer steps over the walk, `nil` when unavailable.
    public var steps: Int?
    /// Accepted points in path order (for the history preview; the server has its own copy from the samples).
    public var points: [LatLng]

    public init(
        clientWalkId: String,
        startedAt: Date,
        endedAt: Date,
        reason: Reason,
        progress: WalkProgress,
        steps: Int?,
        points: [LatLng]
    ) {
        self.clientWalkId = clientWalkId
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.reason = reason
        self.progress = progress
        self.steps = steps
        self.points = points
    }
}

/// A walk found still recording in the store (app killed mid-walk).
public struct RecoverableWalk: Sendable, Equatable {
    public var clientWalkId: String
    public var startedAt: Date
    public var progress: WalkProgress
    public var points: [LatLng]

    public init(clientWalkId: String, startedAt: Date, progress: WalkProgress, points: [LatLng]) {
        self.clientWalkId = clientWalkId
        self.startedAt = startedAt
        self.progress = progress
        self.points = points
    }
}

/// Durable storage of the walk being recorded (implemented by `Persistence.GRDBWalkRepository`; in memory in tests).
/// Every kept sample is stored before anything else happens to it (FR-002); the tracker keeps recording in memory
/// when a call throws (spec edge case "storage fails") and reports the problem once.
public protocol WalkStore: Sendable {
    func createWalk(clientWalkId: String, startedAt: Date) throws
    func append(_ sample: RecordedSample, walkId: String) throws
    func updateProgress(_ progress: WalkProgress, walkId: String) throws
    func markFinished(_ input: WalkFinishInput) throws
    /// The walk with local status `recording`/`paused`, if any, with its progress and accepted points.
    func recordingWalk() throws -> RecoverableWalk?
}
