import Core
import CoreTestSupport
import Foundation
import GRDB
import Location
@testable import Persistence
import XCTest

/// FR-015 on the device: raw samples of synced walks older than 7 days go, paths stay.
final class VacuumTests: XCTestCase {
    func testVacuumDeletesOldSyncedSamplesOnly() throws {
        let harness = try Harness()
        let now = harness.clock.now()
        let eightDaysAgo = now.addingTimeInterval(-8 * 86_400)
        let threeDaysAgo = now.addingTimeInterval(-3 * 86_400)

        func walk(_ id: String, startedAt: Date, synced: Bool) throws {
            try harness.recordWalk(id: id, startedAt: startedAt, samples: 3)
            try harness.repository.markFinished(harness.finishInput(id: id, startedAt: startedAt, endedAt: startedAt.addingTimeInterval(60)))
            if synced {
                try harness.repository.storeSummary(Fixtures.walkSummary(walkId: "srv-\(id)", clientWalkId: id), walkId: id)
            }
        }
        try walk("old-synced", startedAt: eightDaysAgo, synced: true)
        try walk("old-pending", startedAt: eightDaysAgo, synced: false)
        try walk("recent-synced", startedAt: threeDaysAgo, synced: true)
        try harness.recordWalk(id: "recording", startedAt: now, samples: 2)

        let deleted = try harness.repository.vacuum(now: now)
        XCTAssertEqual(deleted, 3, "only the old synced walk's samples")

        func samples(_ id: String) throws -> Int {
            try harness.db.read { db in try Int.fetchOne(db, sql: "SELECT count(*) FROM location_sample WHERE walk_id = ?", arguments: [id]) ?? 0 }
        }
        XCTAssertEqual(try samples("old-synced"), 0)
        XCTAssertEqual(try samples("old-pending"), 3, "unsynced walks keep their samples")
        XCTAssertEqual(try samples("recent-synced"), 3)
        XCTAssertEqual(try samples("recording"), 2)
        XCTAssertEqual(try harness.repository.path(for: "old-synced").count, 3, "the path survives")
        XCTAssertEqual(try harness.repository.localWalk(id: "old-synced")?.summary?.walkId, "srv-old-synced")
        XCTAssertEqual(try harness.repository.vacuum(now: now), 0, "idempotent")
    }
}
