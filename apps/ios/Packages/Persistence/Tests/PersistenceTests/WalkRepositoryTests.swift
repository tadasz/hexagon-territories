import Core
import CoreTestSupport
import Foundation
import GRDB
import H3Kit
import Location
@testable import Persistence
import TerritoryRules
import XCTest

final class WalkRepositoryTests: XCTestCase {
    func testMigrationCreatesTheFourTables() throws {
        let harness = try Harness()
        let tables = try harness.db.read { db in
            try String.fetchAll(
                db,
                sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'grdb_migrations' ORDER BY name"
            )
        }
        XCTAssertEqual(tables, ["location_sample", "outbox", "walk", "walk_path"])
        let applied = try harness.db.read { db in try Migrations.migrator.appliedIdentifiers(db) }
        XCTAssertEqual(applied, ["v1-walks"])
    }

    func testCreateAppendProgressAndFinishRoundTrip() throws {
        let harness = try Harness()
        let start = harness.clock.now()
        let recorded = try harness.recordWalk(id: "w1", samples: 3, rejected: 1)
        var created = try XCTUnwrap(harness.repository.localWalk(id: "w1"))
        XCTAssertEqual(created.status, .recording)
        XCTAssertEqual(created.syncState, .pending)
        XCTAssertEqual(created.startedAt, start)
        XCTAssertNil(created.serverId)

        let cell = H3Index(string: "891f40dabb3ffff")!
        try harness.repository.updateProgress(
            WalkProgress(distanceM: 14, movingSeconds: 10, hexCount: 1, isPaused: true, hexEstimates: [HexMeters(cell: cell, meters: 14)]),
            walkId: "w1"
        )
        created = try XCTUnwrap(harness.repository.localWalk(id: "w1"))
        XCTAssertEqual(created.status, .paused)
        XCTAssertEqual(created.distanceM, 14)
        XCTAssertEqual(created.movingSeconds, 10)
        XCTAssertEqual(created.hexEstimates, [HexMeters(cell: cell, meters: 14)])

        let stored = try harness.db.read { db in try LocationSampleRecord.order(sql: "seq").fetchAll(db) }
        XCTAssertEqual(stored.map(\.seq), [0, 1, 2, 3])
        XCTAssertEqual(stored.map(\.accepted), [true, true, true, false])
        XCTAssertEqual(stored.last?.rejectReason, "accuracy")
        XCTAssertEqual(stored.map(\.sample), recorded.map(\.sample), "samples round-trip exactly")
        XCTAssertEqual(try harness.repository.path(for: "w1").count, 3, "accepted points from the samples while recording")

        // Duplicate seq (a retried append) is ignored, not an error.
        try harness.repository.append(recorded[0], walkId: "w1")
        XCTAssertEqual(try harness.db.read { db in try LocationSampleRecord.fetchCount(db) }, 4)

        let end = start.addingTimeInterval(400)
        let input = harness.finishInput(id: "w1", startedAt: start, endedAt: end, points: recorded.prefix(3).map(\.sample.coordinate), steps: 500)
        try harness.repository.markFinished(input)
        let finished = try XCTUnwrap(harness.repository.localWalk(id: "w1"))
        XCTAssertEqual(finished.status, .finished)
        XCTAssertEqual(finished.endedAt, end)
        XCTAssertEqual(finished.finishReason, "client")
        XCTAssertEqual(finished.distanceM, 321.5)
        XCTAssertEqual(finished.movingSeconds, 400)
        XCTAssertEqual(finished.steps, 500)
        XCTAssertEqual(finished.hexCount, 2)
        XCTAssertEqual(finished.syncState, .pending, "finishing locally does not sync")
        XCTAssertEqual(try harness.repository.path(for: "w1"), recorded.prefix(3).map(\.sample.coordinate))
        XCTAssertNil(try harness.repository.recordingWalk())
    }

    func testFinishWithoutPointsRebuildsThePathFromSamples() throws {
        let harness = try Harness()
        let start = harness.clock.now()
        let recorded = try harness.recordWalk(id: "w1", samples: 4)
        try harness.repository.markFinished(harness.finishInput(id: "w1", startedAt: start, endedAt: start.addingTimeInterval(20)))
        XCTAssertEqual(try harness.repository.path(for: "w1"), recorded.map(\.sample.coordinate))
    }

    func testRecordingWalkRecoversProgressAndPoints() throws {
        let harness = try Harness()
        let start = harness.clock.now()
        let recorded = try harness.recordWalk(id: "crash", samples: 5, rejected: 2)
        let cell = H3Index(string: "891f40dabb3ffff")!
        try harness.repository.updateProgress(
            WalkProgress(distanceM: 28, movingSeconds: 20, hexCount: 1, hexEstimates: [HexMeters(cell: cell, meters: 28)]),
            walkId: "crash"
        )
        let recoverable = try XCTUnwrap(harness.repository.recordingWalk())
        XCTAssertEqual(recoverable.clientWalkId, "crash")
        XCTAssertEqual(recoverable.startedAt, start)
        XCTAssertEqual(recoverable.points, recorded.prefix(5).map(\.sample.coordinate))
        XCTAssertEqual(recoverable.progress.distanceM, 28)
        XCTAssertEqual(recoverable.progress.movingSeconds, 20)
        XCTAssertEqual(recoverable.progress.hexEstimates, [HexMeters(cell: cell, meters: 28)])
        XCTAssertEqual(recoverable.progress.lastSampleTs, recorded.last?.sample.ts, "the last kept sample, rejected or not")
        XCTAssertEqual(recoverable.progress.sampleCount, 7)
        XCTAssertEqual(recoverable.progress.acceptedCount, 5)
        XCTAssertEqual(recoverable.progress.currentCell, try H3.latLngToCell(recorded[4].sample.coordinate, res: 9))
        XCTAssertFalse(recoverable.progress.isPaused)
    }

    func testHistoryOrderingAndUnsyncedFilter() throws {
        let harness = try Harness()
        let t0 = harness.clock.now()
        for (index, id) in ["old", "mid", "new"].enumerated() {
            let start = t0.addingTimeInterval(Double(index) * 3600)
            try harness.recordWalk(id: id, startedAt: start, samples: 2)
            try harness.repository.markFinished(harness.finishInput(id: id, startedAt: start, endedAt: start.addingTimeInterval(600)))
        }
        try harness.repository.setServerId("srv-mid", walkId: "mid")
        try harness.repository.storeSummary(Fixtures.walkSummary(walkId: "srv-mid", clientWalkId: "mid"), walkId: "mid")
        try harness.repository.markFailed(walkId: "old", code: "WALK_OVERLAP")

        XCTAssertEqual(try harness.repository.localWalks(limit: 10).map(\.id), ["new", "mid", "old"], "newest first")
        XCTAssertEqual(try harness.repository.localWalks(limit: 2).map(\.id), ["new", "mid"])
        XCTAssertEqual(try harness.repository.unsyncedWalks().map(\.id), ["new", "old"], "pending and failed, not synced")

        let synced = try XCTUnwrap(harness.repository.localWalk(id: "mid"))
        XCTAssertEqual(synced.syncState, .synced)
        XCTAssertEqual(synced.serverId, "srv-mid")
        XCTAssertEqual(synced.summary?.hexCount, 1)
        XCTAssertEqual(synced.xp, 26)
        XCTAssertEqual(synced.distanceM, 2611.4, "the server's distance replaces the estimate")
        XCTAssertTrue(synced.isSynced)

        let failed = try XCTUnwrap(harness.repository.localWalk(id: "old"))
        XCTAssertEqual(failed.syncState, .failed)
        XCTAssertEqual(failed.syncError, "WALK_OVERLAP")
    }

    func testStoreSummaryKeepsLocalPathAndUsesServerPathWhenEmpty() throws {
        let harness = try Harness()
        let t0 = harness.clock.now()
        try harness.recordWalk(id: "local", samples: 3)
        try harness.repository.markFinished(harness.finishInput(id: "local", startedAt: t0, endedAt: t0.addingTimeInterval(15)))
        try harness.repository.storeSummary(Fixtures.walkSummary(clientWalkId: "local"), walkId: "local")
        XCTAssertEqual(try harness.repository.path(for: "local").count, 3, "local raw points kept")

        try harness.repository.createWalk(clientWalkId: "recovered", startedAt: t0)
        try harness.repository.markFinished(harness.finishInput(id: "recovered", startedAt: t0, endedAt: t0))
        try harness.repository.storeSummary(Fixtures.walkSummary(clientWalkId: "recovered"), walkId: "recovered")
        XCTAssertEqual(try harness.repository.path(for: "recovered"), [LatLng(lat: 54.9035, lon: 23.9320), LatLng(lat: 54.9041, lon: 23.9331)])
        let flagged = Fixtures.walkSummary(clientWalkId: "recovered", flags: [.teleport])
        try harness.repository.storeSummary(flagged, walkId: "recovered")
        XCTAssertEqual(try harness.repository.localWalk(id: "recovered")?.flags, [.teleport])
        XCTAssertEqual(try harness.repository.localWalk(id: "recovered")?.xp, 0)
    }

    func testAppendQueuesABatchAtTwoHundredSamples() throws {
        let harness = try Harness()
        try harness.recordWalk(id: "big", samples: 199)
        XCTAssertEqual(try harness.outbox.pendingCount(), 0)
        try harness.recordWalk(id: "second", samples: 1)
        XCTAssertEqual(try harness.outbox.items(walkId: "big").count, 0)
        let lateSample = Sample(seq: 199, ts: harness.clock.now().addingTimeInterval(995), lat: 54.91, lon: 23.9, hAcc: 8)
        let late = RecordedSample(sample: lateSample, accepted: true, reason: nil)
        try harness.repository.append(late, walkId: "big")
        let items = try harness.outbox.items(walkId: "big")
        XCTAssertEqual(items.map(\.kind), [.samples])
        XCTAssertEqual(items.first?.decodeBatch()?.samples.count, 200)
        XCTAssertEqual(items.first?.decodeBatch()?.samples.map(\.seq), Array(0..<200))
    }
}
