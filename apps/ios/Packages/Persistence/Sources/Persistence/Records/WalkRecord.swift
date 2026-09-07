import Core
import Foundation
import GRDB

/// Local walk lifecycle (`data-model.md` §5): `recording ⇄ paused → finishing → finished`.
public enum LocalWalkStatus: String, Codable, Sendable, Equatable {
    case recording
    case paused
    case finishing
    case finished

    public var isRecording: Bool { self == .recording || self == .paused }
}

/// Upload state of a walk: `pending → syncing → synced | failed`.
public enum SyncState: String, Codable, Sendable, Equatable {
    case pending
    case syncing
    case synced
    case failed
}

/// Row of `walk` (client walk id as primary key). Dates are stored as seconds since 1970.
struct WalkRecord: Codable, FetchableRecord, PersistableRecord, Equatable {
    static let databaseTableName = "walk"

    var id: String
    var serverId: String?
    var startedAt: Double
    var endedAt: Double?
    var status: String
    var finishReason: String?
    var distanceM: Double
    var movingS: Int
    var steps: Int?
    var hexCount: Int
    var xp: Int
    var flags: String
    var summary: String?
    var syncState: String
    var syncError: String?
    var updatedAt: Double

    enum CodingKeys: String, CodingKey {
        case id
        case serverId = "server_id"
        case startedAt = "started_at"
        case endedAt = "ended_at"
        case status
        case finishReason = "finish_reason"
        case distanceM = "distance_m"
        case movingS = "moving_s"
        case steps
        case hexCount = "hex_count"
        case xp
        case flags
        case summary
        case syncState = "sync_state"
        case syncError = "sync_error"
        case updatedAt = "updated_at"
    }
}

extension Date {
    var seconds: Double { timeIntervalSince1970 }

    init(seconds: Double) {
        self.init(timeIntervalSince1970: seconds)
    }
}
