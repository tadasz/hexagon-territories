import Foundation
import GRDB

/// Kind of queued request (`data-model.md` §5 `outbox.kind`).
public enum OutboxKind: String, Codable, Sendable, Equatable {
    case create
    case samples
    case finish
}

/// Row of `outbox`. `payload` is the JSON request body exactly as it will be sent (re-sends are byte-identical).
struct OutboxRecord: Codable, FetchableRecord, MutablePersistableRecord, Equatable {
    static let databaseTableName = "outbox"

    var id: Int64?
    var walkId: String
    var kind: String
    var payload: Data
    var attempts: Int
    var nextAttemptAt: Double
    var lastError: String?
    var createdAt: Double

    enum CodingKeys: String, CodingKey {
        case id
        case walkId = "walk_id"
        case kind, payload, attempts
        case nextAttemptAt = "next_attempt_at"
        case lastError = "last_error"
        case createdAt = "created_at"
    }

    mutating func didInsert(_ inserted: InsertionSuccess) {
        id = inserted.rowID
    }
}

/// A queued request as the coordinator sees it.
public struct OutboxItem: Sendable, Equatable, Identifiable {
    public var id: Int64
    public var walkId: String
    public var kind: OutboxKind
    public var payload: Data
    public var attempts: Int
    public var nextAttemptAt: Date
    public var lastError: String?

    init?(_ record: OutboxRecord) {
        guard let id = record.id, let kind = OutboxKind(rawValue: record.kind) else { return nil }
        self.id = id
        walkId = record.walkId
        self.kind = kind
        payload = record.payload
        attempts = record.attempts
        nextAttemptAt = Date(seconds: record.nextAttemptAt)
        lastError = record.lastError
    }
}
