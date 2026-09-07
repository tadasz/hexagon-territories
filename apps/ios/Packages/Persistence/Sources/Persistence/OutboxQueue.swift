import Core
import Foundation
import GRDB
import Location

/// The durable upload queue (research.md R17, FR-006): `create` at start, `samples` batches of ≤ 200 kept samples
/// (each sample belongs to exactly one batch — `location_sample.outbox_id` — so re-sends are idempotent by
/// `(walkId, seq)`), `finish` at stop. `next(now:)` is FIFO per walk (a walk's items in `id` order, walks interleaved
/// by `id`): only the head item of each walk is eligible, so a walk whose head is backing off never blocks another.
public final class OutboxQueue: @unchecked Sendable {
    let db: DatabaseQueue

    public init(db: DatabaseQueue) {
        self.db = db
    }

    // MARK: Enqueue

    public func enqueueCreate(walkId: String, request: WalkCreateRequest, now: Date) throws {
        try db.write { db in
            try Self.insert(db, walkId: walkId, kind: .create, payload: try JSONCoding.encoder().encode(request), now: now)
        }
    }

    /// Queues every kept sample not yet in a batch, in `seq` order, in chunks of ≤ 200. With `onlyFullBatches`
    /// only complete chunks are queued (the 200-sample trigger); the 60 s timer and the finish queue the remainder.
    /// Returns the number of batch items created.
    @discardableResult
    public func enqueueSamples(walkId: String, now: Date, pedometer: PedometerWindow? = nil, onlyFullBatches: Bool = false) throws -> Int {
        try db.write { db in
            try Self.enqueueSamples(db, walkId: walkId, now: now, pedometer: pedometer, onlyFullBatches: onlyFullBatches)
        }
    }

    public func enqueueFinish(walkId: String, request: WalkFinishRequest, now: Date) throws {
        try db.write { db in
            try Self.insert(db, walkId: walkId, kind: .finish, payload: try JSONCoding.encoder().encode(request), now: now)
        }
    }

    // MARK: Drain

    /// The next due item: the lowest-id item among the heads of every walk, if its `next_attempt_at` has passed.
    public func next(now: Date) throws -> OutboxItem? {
        try db.read { db in
            try OutboxRecord
                .filter(sql: "id IN (SELECT min(id) FROM outbox GROUP BY walk_id) AND next_attempt_at <= ?", arguments: [now.seconds])
                .order(sql: "id")
                .fetchOne(db)
                .flatMap(OutboxItem.init)
        }
    }

    public func succeed(id: Int64) throws {
        try db.write { db in
            _ = try OutboxRecord.deleteOne(db, key: id)
        }
    }

    public func fail(id: Int64, error: String, retryAt: Date) throws {
        try db.write { db in
            try db.execute(
                sql: "UPDATE outbox SET attempts = attempts + 1, next_attempt_at = ?, last_error = ? WHERE id = ?",
                arguments: [retryAt.seconds, error, id]
            )
        }
    }

    /// Removes every queued item of the walk (permanent failure). Returns how many were dropped.
    @discardableResult
    public func dropWalk(walkId: String) throws -> Int {
        try db.write { db in
            try OutboxRecord.filter(sql: "walk_id = ?", arguments: [walkId]).deleteAll(db)
        }
    }

    public func items(walkId: String? = nil) throws -> [OutboxItem] {
        try db.read { db in
            let request = walkId.map { OutboxRecord.filter(sql: "walk_id = ?", arguments: [$0]) } ?? OutboxRecord.all()
            return try request.order(sql: "id").fetchAll(db).compactMap(OutboxItem.init)
        }
    }

    public func pendingCount() throws -> Int {
        try db.read { db in try OutboxRecord.fetchCount(db) }
    }

    /// Earliest `next_attempt_at` among the walk heads (when to wake the drain), or `nil` when the queue is empty.
    public func earliestAttempt() throws -> Date? {
        try db.read { db in
            try Double.fetchOne(db, sql: "SELECT min(next_attempt_at) FROM outbox WHERE id IN (SELECT min(id) FROM outbox GROUP BY walk_id)")
                .map { Date(seconds: $0) }
        }
    }

    // MARK: Internal (shared with the repository, inside its transactions)

    static func insert(_ db: Database, walkId: String, kind: OutboxKind, payload: Data, now: Date) throws {
        var record = OutboxRecord(
            id: nil,
            walkId: walkId,
            kind: kind.rawValue,
            payload: payload,
            attempts: 0,
            nextAttemptAt: now.seconds,
            lastError: nil,
            createdAt: now.seconds
        )
        try record.insert(db)
    }

    @discardableResult
    static func enqueueSamples(
        _ db: Database,
        walkId: String,
        now: Date,
        pedometer: PedometerWindow? = nil,
        onlyFullBatches: Bool = false
    ) throws -> Int {
        let uncovered = try LocationSampleRecord
            .filter(sql: "walk_id = ? AND outbox_id IS NULL", arguments: [walkId])
            .order(sql: "seq")
            .fetchAll(db)
        var created = 0
        var index = 0
        while index < uncovered.count {
            let chunk = Array(uncovered[index..<min(index + SampleBatchRequest.maxSamples, uncovered.count)])
            if onlyFullBatches, chunk.count < SampleBatchRequest.maxSamples { break }
            let samples = chunk.map { record in
                LocationSample(
                    seq: record.seq, ts: Date(seconds: record.ts), lat: record.lat, lon: record.lon, hAcc: record.hAcc,
                    speed: record.speed, course: record.course, alt: record.alt
                )
            }
            // The pedometer window rides on the last batch of this call only.
            let isLast = index + chunk.count >= uncovered.count
            let request = SampleBatchRequest(samples: samples, pedometer: isLast ? pedometer : nil)
            var record = OutboxRecord(
                id: nil,
                walkId: walkId,
                kind: OutboxKind.samples.rawValue,
                payload: try JSONCoding.encoder().encode(request),
                attempts: 0,
                nextAttemptAt: now.seconds,
                lastError: nil,
                createdAt: now.seconds
            )
            try record.insert(db)
            guard let outboxId = record.id, let first = chunk.first?.seq, let last = chunk.last?.seq else { break }
            try db.execute(
                sql: "UPDATE location_sample SET outbox_id = ? WHERE walk_id = ? AND seq BETWEEN ? AND ? AND outbox_id IS NULL",
                arguments: [outboxId, walkId, first, last]
            )
            created += 1
            index += chunk.count
        }
        return created
    }
}
