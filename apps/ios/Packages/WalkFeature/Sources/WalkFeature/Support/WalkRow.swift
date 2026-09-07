import Core
import Foundation
import H3Kit
import Persistence

/// One row of the walk history (spec US4 scenario 1/4; plan.md Shared Semantics 9): a server list item or a local
/// walk that is still pending upload (or failed), merged on top.
public struct WalkRow: Sendable, Equatable, Identifiable {
    public enum Status: Sendable, Equatable {
        case recording
        case finished
        case flagged([Core.WalkFlag])
        case autoFinished
        case superseded
        case pendingUpload
        case uploadFailed(String)
    }

    /// Client walk id for local rows, server walk id otherwise.
    public var id: String
    public var serverId: String?
    public var clientWalkId: String
    public var startedAt: Date
    public var distanceM: Double
    public var durationS: Int
    public var hexCount: Int
    public var xp: Int?
    public var status: Status
    /// Accepted points for the preview (local walks only; server list items carry no path).
    public var path: [LatLng]
    public var isLocal: Bool

    public init(local walk: LocalWalk, path: [LatLng]) {
        id = walk.id
        serverId = walk.serverId
        clientWalkId = walk.id
        startedAt = walk.startedAt
        distanceM = walk.distanceM
        durationS = walk.movingSeconds
        hexCount = walk.hexCount
        xp = walk.isSynced ? walk.xp : nil
        self.path = path
        isLocal = true
        if walk.status.isRecording {
            status = .recording
        } else if let summary = walk.summary {
            status = Self.status(status: summary.status, flags: summary.flags, finishReason: summary.finishReason)
        } else if walk.syncState == .failed {
            status = .uploadFailed(walk.syncError ?? "unknown")
        } else {
            status = .pendingUpload
        }
    }

    public init(item: WalkListItem) {
        id = item.walkId
        serverId = item.walkId
        clientWalkId = item.clientWalkId
        startedAt = item.startedAt
        distanceM = item.distanceM
        durationS = item.durationS
        hexCount = item.hexCount
        xp = item.xp
        path = []
        isLocal = false
        status = Self.status(status: item.status, flags: item.flags, finishReason: item.finishReason)
    }

    static func status(status: WalkStatus, flags: [Core.WalkFlag], finishReason: FinishReason?) -> Status {
        if status == .flagged || !flags.isEmpty { return .flagged(flags) }
        switch finishReason {
        case .autofinish: return .autoFinished
        case .superseded: return .superseded
        default: return .finished
        }
    }

    public var distanceText: String {
        distanceM >= 1000 ? String(format: "%.1f km", distanceM / 1000) : "\(Int(distanceM.rounded())) m"
    }

    public var durationText: String {
        let hours = durationS / 3600
        let minutes = durationS % 3600 / 60
        return hours > 0 ? "\(hours) h \(minutes) min" : "\(minutes) min"
    }

    public var xpText: String { xp.map { "\($0) XP" } ?? "XP pending" }

    /// One-line explanation per status (spec US4 scenario 4).
    public var statusLine: String {
        switch status {
        case .recording: "Recording"
        case .finished: "Scored"
        case let .flagged(flags): "Flagged: " + flags.map(\.explanation).joined(separator: ", ") + " — earned no metres"
        case .autoFinished: "Auto-finished by the server after 12 hours"
        case .superseded: "Finished automatically when a newer walk started"
        case .pendingUpload: "Pending upload"
        case let .uploadFailed(code): "Upload failed (\(code))"
        }
    }

    public var isPending: Bool {
        if case .pendingUpload = status { return true }
        return false
    }
}
