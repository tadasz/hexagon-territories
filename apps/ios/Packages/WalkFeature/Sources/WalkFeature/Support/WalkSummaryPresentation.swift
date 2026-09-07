import Core
import Foundation
import H3Kit
import Location
import Persistence
import TerritoryRules

/// What the finish sheet and the detail view render (spec US2 scenario 1, US3 scenario 2, US4 scenario 2): either
/// the device's provisional numbers ("pending upload", every value an estimate) or the server's `WalkSummary`.
public struct WalkSummaryPresentation: Sendable, Equatable {
    public enum Source: Sendable, Equatable {
        /// Local estimate, the finish is still in the outbox.
        case provisional
        /// The server's answer (Constitution I).
        case server
    }

    public struct HexRow: Sendable, Equatable, Identifiable {
        public var h3: String
        public var meters: Double
        /// Metres that counted toward the weekly cap (`nil` while provisional).
        public var cappedMeters: Double?
        public var leaderFactionId: Int?
        public var myFactionShare: Double?
        public var ownerFactionId: Int?

        public var id: String { h3 }
        /// The last five significant digits: a res-9 index ends in `f` padding for the unused resolutions, so the
        /// digits before that run are what tell neighbouring cells apart.
        public var shortId: String { HUDState.shortCellId(h3) }
        public var metersText: String { "\(Int(meters.rounded())) m" }
        public var countedText: String? { cappedMeters.map { "\(Int($0.rounded())) m counted" } }
        public var shareText: String? { myFactionShare.map { "your faction \(Int(($0 * 100).rounded())) %" } }
    }

    public var clientWalkId: String
    public var serverWalkId: String?
    public var source: Source
    public var startedAt: Date
    public var endedAt: Date?
    public var distanceM: Double
    public var durationS: Int
    public var xp: Int?
    public var flags: [Core.WalkFlag]
    public var scored: Bool
    public var hexes: [HexRow]
    public var weekId: String?
    public var finishReason: FinishReason?
    public var steps: Int?
    /// Set when the upload failed permanently (`sync_error` code).
    public var uploadFailure: String?
    /// Points for the preview: the local accepted path, or the server's simplified path.
    public var path: [LatLng]

    public init(provisional: ProvisionalSummary, path: [LatLng] = []) {
        clientWalkId = provisional.clientWalkId
        serverWalkId = nil
        source = .provisional
        startedAt = provisional.startedAt
        endedAt = provisional.endedAt
        distanceM = provisional.distanceM
        durationS = provisional.movingSeconds
        xp = nil
        flags = []
        scored = false
        hexes = provisional.hexes.map { HexRow(h3: $0.cell.description, meters: $0.meters) }
        weekId = nil
        finishReason = nil
        steps = provisional.steps
        uploadFailure = nil
        self.path = path
    }

    public init(server summary: WalkSummary) {
        clientWalkId = summary.clientWalkId
        serverWalkId = summary.walkId
        source = .server
        startedAt = summary.startedAt
        endedAt = summary.endedAt
        distanceM = summary.distanceM
        durationS = summary.durationS
        xp = summary.xp
        flags = summary.flags
        scored = summary.scored
        hexes = summary.hexes.map {
            HexRow(
                h3: $0.h3,
                meters: $0.meters,
                cappedMeters: $0.cappedMeters,
                leaderFactionId: $0.weekStanding.leader,
                myFactionShare: $0.weekStanding.myFactionShare,
                ownerFactionId: $0.weekStanding.owner
            )
        }
        weekId = summary.weekId
        finishReason = summary.finishReason
        steps = summary.steps
        uploadFailure = nil
        path = summary.path?.latLonPairs.map { LatLng(lat: $0.lat, lon: $0.lon) } ?? []
    }

    /// A walk from the local store: the server summary when synced, else the estimate (with the failure code).
    public init(local walk: LocalWalk, path: [LatLng] = []) {
        if let summary = walk.summary {
            self = WalkSummaryPresentation(server: summary)
            if !path.isEmpty { self.path = path }
            return
        }
        clientWalkId = walk.id
        serverWalkId = walk.serverId
        source = .provisional
        startedAt = walk.startedAt
        endedAt = walk.endedAt
        distanceM = walk.distanceM
        durationS = walk.movingSeconds
        xp = nil
        flags = walk.flags
        scored = false
        hexes = walk.hexEstimates.map { HexRow(h3: $0.cell.description, meters: $0.meters) }
        weekId = nil
        finishReason = nil
        steps = walk.steps
        uploadFailure = walk.syncState == .failed ? walk.syncError : nil
        self.path = path
    }

    public var isProvisional: Bool { source == .provisional }
    public var isFlagged: Bool { !flags.isEmpty }
    public var hexCount: Int { hexes.count }

    public var distanceText: String {
        distanceM >= 1000 ? String(format: "%.2f km", distanceM / 1000) : "\(Int(distanceM.rounded())) m"
    }

    public var durationText: String {
        let hours = durationS / 3600
        let minutes = durationS % 3600 / 60
        return hours > 0 ? "\(hours) h \(minutes) min" : "\(minutes) min"
    }

    public var xpText: String {
        guard let xp else { return "XP pending" }
        return "\(xp) XP"
    }

    /// The one-line status under the title.
    public var statusLine: String {
        if let uploadFailure {
            return "Upload failed (\(uploadFailure)). This walk could not be scored."
        }
        if isProvisional {
            return "Pending upload — these numbers are estimates until the server scores the walk."
        }
        if isFlagged {
            return "Flagged — earned no metres."
        }
        switch finishReason {
        case .autofinish: return "Finished automatically by the server after 12 hours."
        case .superseded: return "Finished automatically when a newer walk started."
        default: return weekId.map { "Scored for week \($0)." } ?? "Scored."
        }
    }

    /// Spec US2 scenario 4: "This walk was flagged (reason) and earned no metres".
    public var flagsBanner: String? {
        guard isFlagged else { return nil }
        let reasons = flags.map(\.explanation).joined(separator: ", ")
        return "This walk was flagged (\(reasons)) and earned no metres."
    }

    /// Label for the per-hex metre column.
    public var metersColumnTitle: String {
        isProvisional ? "≈ metres (estimate)" : "metres"
    }
}
