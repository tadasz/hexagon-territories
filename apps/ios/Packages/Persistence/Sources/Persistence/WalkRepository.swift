import Core
import Foundation
import GRDB
import H3Kit
import Location
import TerritoryRules

/// A walk as stored on the device (row of `walk` plus its path/estimates), for the history list and the detail view.
public struct LocalWalk: Sendable, Equatable, Identifiable {
    public var id: String
    public var serverId: String?
    public var startedAt: Date
    public var endedAt: Date?
    public var status: LocalWalkStatus
    public var finishReason: String?
    public var distanceM: Double
    public var movingSeconds: Int
    public var steps: Int?
    public var hexCount: Int
    public var xp: Int
    public var flags: [Core.WalkFlag]
    public var summary: WalkSummary?
    public var syncState: SyncState
    public var syncError: String?
    public var updatedAt: Date
    /// Estimated metres per cell (the provisional numbers while the walk is not synced).
    public var hexEstimates: [HexMeters]

    public var isSynced: Bool { syncState == .synced }
}

/// What the feature layer needs from storage (`data-model.md` §5). `GRDBWalkRepository` is the implementation;
/// `Location.WalkStore` is the recording half.
public protocol WalkRepository: WalkStore {
    func localWalk(id: String) throws -> LocalWalk?
    /// Newest first.
    func localWalks(limit: Int) throws -> [LocalWalk]
    /// Walks whose `sync_state` is not `synced`, newest first (merged on top of the server's first page).
    func unsyncedWalks() throws -> [LocalWalk]
    /// Accepted points of the walk (from `walk_path`, or the stored samples while recording).
    func path(for walkId: String) throws -> [LatLng]
    /// Deletes raw samples of `synced` walks that ended more than `retention` ago; paths are kept. Returns rows deleted.
    @discardableResult
    func vacuum(now: Date, retention: TimeInterval) throws -> Int
}

/// GRDB implementation over one `DatabaseQueue` shared with `OutboxQueue`.
public final class GRDBWalkRepository: WalkRepository, @unchecked Sendable {
    /// Raw samples of uploaded walks are kept this long on the device (FR-015).
    public static let sampleRetention: TimeInterval = 7 * 86_400

    let db: DatabaseQueue
    private let clock: any Clock

    public init(db: DatabaseQueue, clock: any Clock = SystemClock()) {
        self.db = db
        self.clock = clock
    }

    // MARK: WalkStore (recording)

    public func createWalk(clientWalkId: String, startedAt: Date) throws {
        let now = clock.now().seconds
        try db.write { db in
            try WalkRecord(
                id: clientWalkId,
                serverId: nil,
                startedAt: startedAt.seconds,
                endedAt: nil,
                status: LocalWalkStatus.recording.rawValue,
                finishReason: nil,
                distanceM: 0,
                movingS: 0,
                steps: nil,
                hexCount: 0,
                xp: 0,
                flags: "[]",
                summary: nil,
                syncState: SyncState.pending.rawValue,
                syncError: nil,
                updatedAt: now
            ).insert(db, onConflict: .replace)
            try WalkPathRecord(
                walkId: clientWalkId,
                points: WalkPathRecord.encode(points: []),
                hexEstimates: WalkPathRecord.encode(hexEstimates: []),
                updatedAt: now
            ).insert(db, onConflict: .replace)
        }
    }

    public func append(_ sample: RecordedSample, walkId: String) throws {
        let now = clock.now()
        try db.write { db in
            try LocationSampleRecord(sample, walkId: walkId).insert(db, onConflict: .ignore)
            // 200 kept samples not yet covered by a batch → queue a batch now (plan.md Shared Semantics 4).
            let uncovered = try Int.fetchOne(
                db,
                sql: "SELECT count(*) FROM location_sample WHERE walk_id = ? AND outbox_id IS NULL",
                arguments: [walkId]
            ) ?? 0
            if uncovered >= SampleBatchRequest.maxSamples {
                _ = try OutboxQueue.enqueueSamples(db, walkId: walkId, now: now, onlyFullBatches: true)
            }
        }
    }

    public func updateProgress(_ progress: WalkProgress, walkId: String) throws {
        let now = clock.now().seconds
        try db.write { db in
            try db.execute(
                sql: """
                UPDATE walk SET status = ?, distance_m = ?, moving_s = ?, hex_count = ?, updated_at = ?
                WHERE id = ? AND status IN ('recording', 'paused')
                """,
                arguments: [
                    (progress.isPaused ? LocalWalkStatus.paused : .recording).rawValue,
                    progress.distanceM, progress.movingSeconds, progress.hexCount, now, walkId,
                ]
            )
            try db.execute(
                sql: "UPDATE walk_path SET hex_estimates = ?, updated_at = ? WHERE walk_id = ?",
                arguments: [WalkPathRecord.encode(hexEstimates: progress.hexEstimates), now, walkId]
            )
        }
    }

    public func markFinished(_ input: WalkFinishInput) throws {
        let now = clock.now().seconds
        try db.write { db in
            try db.execute(
                sql: """
                UPDATE walk SET status = ?, ended_at = ?, finish_reason = ?, distance_m = ?, moving_s = ?, steps = ?,
                    hex_count = ?, updated_at = ?
                WHERE id = ?
                """,
                arguments: [
                    LocalWalkStatus.finished.rawValue, input.endedAt.seconds, input.reason.rawValue,
                    input.progress.distanceM, input.progress.movingSeconds, input.steps, input.progress.hexCount, now,
                    input.clientWalkId,
                ]
            )
            let points = input.points.isEmpty ? try Self.acceptedPoints(db, walkId: input.clientWalkId) : input.points
            try WalkPathRecord(
                walkId: input.clientWalkId,
                points: WalkPathRecord.encode(points: points),
                hexEstimates: WalkPathRecord.encode(hexEstimates: input.progress.hexEstimates),
                updatedAt: now
            ).insert(db, onConflict: .replace)
        }
    }

    public func recordingWalk() throws -> RecoverableWalk? {
        try db.read { db in
            guard let record = try WalkRecord
                .filter(sql: "status IN ('recording', 'paused')")
                .order(sql: "started_at DESC")
                .fetchOne(db)
            else { return nil }
            let path = try WalkPathRecord.fetchOne(db, key: record.id)
            let lastTs = try Double.fetchOne(db, sql: "SELECT max(ts) FROM location_sample WHERE walk_id = ?", arguments: [record.id])
            let counts = try Row.fetchOne(
                db,
                sql: "SELECT count(*) AS total, sum(accepted) AS accepted FROM location_sample WHERE walk_id = ?",
                arguments: [record.id]
            )
            let hexEstimates = path.map { WalkPathRecord.decodeHexEstimates($0.hexEstimates) } ?? []
            let points = try Self.acceptedPoints(db, walkId: record.id)
            let progress = WalkProgress(
                distanceM: record.distanceM,
                movingSeconds: record.movingS,
                hexCount: record.hexCount,
                isPaused: record.status == LocalWalkStatus.paused.rawValue,
                hexEstimates: hexEstimates,
                currentCell: points.last.flatMap { try? H3.latLngToCell($0, res: Rules.res) },
                lastSampleTs: lastTs.map { Date(seconds: $0) },
                sampleCount: counts?["total"] ?? 0,
                acceptedCount: counts?["accepted"] ?? 0
            )
            return RecoverableWalk(clientWalkId: record.id, startedAt: Date(seconds: record.startedAt), progress: progress, points: points)
        }
    }

    // MARK: History

    public func localWalk(id: String) throws -> LocalWalk? {
        try db.read { db in
            guard let record = try WalkRecord.fetchOne(db, key: id) else { return nil }
            return try Self.localWalk(db, record)
        }
    }

    public func localWalks(limit: Int) throws -> [LocalWalk] {
        try db.read { db in
            try WalkRecord.order(sql: "started_at DESC").limit(limit).fetchAll(db).map { try Self.localWalk(db, $0) }
        }
    }

    public func unsyncedWalks() throws -> [LocalWalk] {
        try db.read { db in
            try WalkRecord.filter(sql: "sync_state <> ?", arguments: [SyncState.synced.rawValue])
                .order(sql: "started_at DESC")
                .fetchAll(db)
                .map { try Self.localWalk(db, $0) }
        }
    }

    public func path(for walkId: String) throws -> [LatLng] {
        try db.read { db in
            if let path = try WalkPathRecord.fetchOne(db, key: walkId) {
                let points = WalkPathRecord.decodePoints(path.points)
                if !points.isEmpty { return points }
            }
            return try Self.acceptedPoints(db, walkId: walkId)
        }
    }

    @discardableResult
    public func vacuum(now: Date, retention: TimeInterval = GRDBWalkRepository.sampleRetention) throws -> Int {
        try db.write { db in
            try db.execute(
                sql: """
                DELETE FROM location_sample WHERE walk_id IN (
                    SELECT id FROM walk WHERE sync_state = ? AND ended_at IS NOT NULL AND ended_at < ?
                )
                """,
                arguments: [SyncState.synced.rawValue, now.addingTimeInterval(-retention).seconds]
            )
            return db.changesCount
        }
    }

    // MARK: Sync bookkeeping (used by `SyncCoordinator`)

    func setServerId(_ serverId: String, walkId: String) throws {
        let now = clock.now().seconds
        try db.write { db in
            try db.execute(
                sql: "UPDATE walk SET server_id = ?, sync_state = ?, sync_error = NULL, updated_at = ? WHERE id = ?",
                arguments: [serverId, SyncState.syncing.rawValue, now, walkId]
            )
        }
    }

    func storeSummary(_ summary: WalkSummary, walkId: String) throws {
        let now = clock.now().seconds
        let json = String(data: try JSONCoding.encoder().encode(summary), encoding: .utf8)
        let flags = String(data: try JSONEncoder().encode(summary.flags.map(\.rawValue)), encoding: .utf8) ?? "[]"
        try db.write { db in
            try db.execute(
                sql: """
                UPDATE walk SET server_id = ?, summary = ?, sync_state = ?, sync_error = NULL, xp = ?, flags = ?,
                    hex_count = ?, distance_m = ?, status = ?, ended_at = coalesce(ended_at, ?), updated_at = ?
                WHERE id = ?
                """,
                arguments: [
                    summary.walkId, json, SyncState.synced.rawValue, summary.xp, flags, summary.hexCount,
                    summary.distanceM, LocalWalkStatus.finished.rawValue, summary.endedAt?.seconds, now, walkId,
                ]
            )
            // A recovered walk without local points takes the server's simplified path for its preview.
            if let path = try WalkPathRecord.fetchOne(db, key: walkId), WalkPathRecord.decodePoints(path.points).isEmpty,
               let serverPath = summary.path {
                let points = serverPath.latLonPairs.map { LatLng(lat: $0.lat, lon: $0.lon) }
                try db.execute(
                    sql: "UPDATE walk_path SET points = ?, updated_at = ? WHERE walk_id = ?",
                    arguments: [WalkPathRecord.encode(points: points), now, walkId]
                )
            }
        }
    }

    func markFailed(walkId: String, code: String) throws {
        let now = clock.now().seconds
        try db.write { db in
            try db.execute(
                sql: "UPDATE walk SET sync_state = ?, sync_error = ?, updated_at = ? WHERE id = ?",
                arguments: [SyncState.failed.rawValue, code, now, walkId]
            )
        }
    }

    func serverId(walkId: String) throws -> String? {
        try db.read { db in
            try String.fetchOne(db, sql: "SELECT server_id FROM walk WHERE id = ?", arguments: [walkId])
        }
    }

    // MARK: Private

    static func acceptedPoints(_ db: Database, walkId: String) throws -> [LatLng] {
        try Row.fetchAll(
            db,
            sql: "SELECT lat, lon FROM location_sample WHERE walk_id = ? AND accepted = 1 ORDER BY seq",
            arguments: [walkId]
        ).map { LatLng(lat: $0["lat"], lon: $0["lon"]) }
    }

    static func localWalk(_ db: Database, _ record: WalkRecord) throws -> LocalWalk {
        let path = try WalkPathRecord.fetchOne(db, key: record.id)
        let summary = record.summary.flatMap { try? JSONCoding.decoder().decode(WalkSummary.self, from: Data($0.utf8)) }
        let flags = ((try? JSONDecoder().decode([String].self, from: Data(record.flags.utf8))) ?? []).compactMap(Core.WalkFlag.init(rawValue:))
        return LocalWalk(
            id: record.id,
            serverId: record.serverId,
            startedAt: Date(seconds: record.startedAt),
            endedAt: record.endedAt.map { Date(seconds: $0) },
            status: LocalWalkStatus(rawValue: record.status) ?? .finished,
            finishReason: record.finishReason,
            distanceM: record.distanceM,
            movingSeconds: record.movingS,
            steps: record.steps,
            hexCount: record.hexCount,
            xp: record.xp,
            flags: flags,
            summary: summary,
            syncState: SyncState(rawValue: record.syncState) ?? .pending,
            syncError: record.syncError,
            updatedAt: Date(seconds: record.updatedAt),
            hexEstimates: path.map { WalkPathRecord.decodeHexEstimates($0.hexEstimates) } ?? []
        )
    }
}
