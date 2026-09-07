import Foundation
import H3Kit
import TerritoryRules

/// What the walk HUD renders (data-model.md §6 "Location presentation values"), derived from `LivePath`.
public struct HUDState: Sendable, Equatable {
    public var movingSeconds: Int
    public var distanceM: Double
    public var currentCell: H3Index?
    public var currentCellMeters: Double
    public var hexCount: Int
    public var isPaused: Bool
    public var waitingForGPS: Bool

    public init(
        movingSeconds: Int = 0,
        distanceM: Double = 0,
        currentCell: H3Index? = nil,
        currentCellMeters: Double = 0,
        hexCount: Int = 0,
        isPaused: Bool = false,
        waitingForGPS: Bool = false
    ) {
        self.movingSeconds = movingSeconds
        self.distanceM = distanceM
        self.currentCell = currentCell
        self.currentCellMeters = currentCellMeters
        self.hexCount = hexCount
        self.isPaused = isPaused
        self.waitingForGPS = waitingForGPS
    }

    @MainActor
    public init(_ path: LivePath) {
        self.init(
            movingSeconds: path.movingSeconds,
            distanceM: path.distanceM,
            currentCell: path.currentCell,
            currentCellMeters: path.currentCellMeters,
            hexCount: path.hexCount,
            isPaused: path.isPaused,
            waitingForGPS: path.waitingForGPS
        )
    }

    /// `hh:mm:ss` (or `mm:ss` under an hour).
    public var movingTimeText: String {
        let hours = movingSeconds / 3600
        let minutes = movingSeconds % 3600 / 60
        let seconds = movingSeconds % 60
        return hours > 0
            ? String(format: "%d:%02d:%02d", hours, minutes, seconds)
            : String(format: "%02d:%02d", minutes, seconds)
    }

    /// `1.2 km` above a kilometre, `850 m` below.
    public var distanceText: String {
        distanceM >= 1000 ? String(format: "%.1f km", distanceM / 1000) : "\(Int(distanceM.rounded())) m"
    }

    /// A short label for the cell: the last five significant digits (the trailing `f` run of a res-9 index is the
    /// padding of the unused resolutions 10–15 and is the same for every cell).
    public var currentCellShortId: String? {
        currentCell.map { Self.shortCellId($0.description) }
    }

    public static func shortCellId(_ h3: String) -> String {
        var significant = Substring(h3)
        while significant.count > 5, significant.hasSuffix("f") {
            significant = significant.dropLast()
        }
        return String(significant.suffix(5))
    }

    /// "≈ 42 m in this hex (estimate)" — the label is part of the value so no screen forgets it (Constitution I).
    public var currentCellText: String {
        "≈ \(Int(currentCellMeters.rounded())) m in this hex (estimate)"
    }
}

/// The local summary shown while the finish is still queued (spec US3 scenario 2); replaced by `WalkSummary`.
public struct ProvisionalSummary: Sendable, Equatable {
    public var clientWalkId: String
    public var startedAt: Date
    public var endedAt: Date
    public var distanceM: Double
    public var movingSeconds: Int
    public var hexes: [HexMeters]
    public var steps: Int?

    public init(_ input: WalkFinishInput) {
        clientWalkId = input.clientWalkId
        startedAt = input.startedAt
        endedAt = input.endedAt
        distanceM = input.progress.distanceM
        movingSeconds = input.progress.movingSeconds
        hexes = input.progress.hexEstimates
        steps = input.steps
    }

    public var hexCount: Int { hexes.count }
}
