import Foundation
import H3Kit
import Observation
import TerritoryRules

/// Immutable copy of the tracker's live state, pushed to `LivePath` after every accepted sample and tick.
public struct PathSnapshot: Sendable, Equatable {
    public var points: [LatLng]
    public var hexEstimates: [HexMeters]
    public var currentCell: H3Index?
    public var currentCellMeters: Double
    public var distanceM: Double
    public var movingSeconds: Int
    public var hexCount: Int
    public var isPaused: Bool
    public var isRecording: Bool
    public var storeWarning: Bool

    public init(
        points: [LatLng] = [],
        hexEstimates: [HexMeters] = [],
        currentCell: H3Index? = nil,
        currentCellMeters: Double = 0,
        distanceM: Double = 0,
        movingSeconds: Int = 0,
        hexCount: Int = 0,
        isPaused: Bool = false,
        isRecording: Bool = false,
        storeWarning: Bool = false
    ) {
        self.points = points
        self.hexEstimates = hexEstimates
        self.currentCell = currentCell
        self.currentCellMeters = currentCellMeters
        self.distanceM = distanceM
        self.movingSeconds = movingSeconds
        self.hexCount = hexCount
        self.isPaused = isPaused
        self.isRecording = isRecording
        self.storeWarning = storeWarning
    }

    /// No accepted sample yet (cold GPS): the HUD shows "waiting for GPS".
    public var waitingForGPS: Bool { isRecording && points.isEmpty }
}

/// The observable live path (FR-005, research.md R16): the model feature 005's `WalkPathsLayer` draws and the walk
/// HUD reads. Written only by `WalkTracker` (through `apply`), on the main actor.
@Observable
@MainActor
public final class LivePath {
    /// Accepted points in path order.
    public private(set) var points: [LatLng] = []
    /// Estimated metres per res-9 cell, sorted by cell.
    public private(set) var hexEstimates: [HexMeters] = []
    public private(set) var currentCell: H3Index?
    public private(set) var currentCellMeters: Double = 0
    public private(set) var distanceM: Double = 0
    public private(set) var movingSeconds: Int = 0
    public private(set) var hexCount: Int = 0
    public private(set) var isPaused = false
    public private(set) var isRecording = false
    public private(set) var waitingForGPS = false
    /// True after the local store failed once during this walk (the walk continues in memory).
    public private(set) var storeWarning = false

    public init() {}

    public func apply(_ snapshot: PathSnapshot) {
        points = snapshot.points
        hexEstimates = snapshot.hexEstimates
        currentCell = snapshot.currentCell
        currentCellMeters = snapshot.currentCellMeters
        distanceM = snapshot.distanceM
        movingSeconds = snapshot.movingSeconds
        hexCount = snapshot.hexCount
        isPaused = snapshot.isPaused
        isRecording = snapshot.isRecording
        waitingForGPS = snapshot.waitingForGPS
        storeWarning = snapshot.storeWarning
    }

    public func reset() {
        apply(PathSnapshot())
    }

    public var hud: HUDState { HUDState(self) }
}
