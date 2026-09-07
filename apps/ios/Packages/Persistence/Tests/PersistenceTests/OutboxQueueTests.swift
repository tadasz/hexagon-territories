import Core
import CoreTestSupport
import Foundation
import Location
@testable import Persistence
import TerritoryRules
import XCTest

final class OutboxQueueTests: XCTestCase {
    func testFifoPerWalkAndInterleavingById() throws {
        let harness = try Harness()
        let now = harness.clock.now()
        try harness.recordWalk(id: "a", samples: 3)
        try harness.recordWalk(id: "b", samples: 2)
        try harness.outbox.enqueueCreate(walkId: "a", request: WalkCreateRequest(clientWalkId: "a", startedAt: now), now: now)
        try harness.outbox.enqueueSamples(walkId: "a", now: now)
        try harness.outbox.enqueueCreate(walkId: "b", request: WalkCreateRequest(clientWalkId: "b", startedAt: now), now: now)
        try harness.outbox.enqueueFinish(walkId: "a", request: WalkFinishRequest(endedAt: now), now: now)
        try harness.outbox.enqueueSamples(walkId: "b", now: now)
        try harness.outbox.enqueueFinish(walkId: "b", request: WalkFinishRequest(endedAt: now), now: now)
        XCTAssertEqual(try harness.outbox.pendingCount(), 6)

        var delivered: [String] = []
        while let item = try harness.outbox.next(now: now) {
            delivered.append("\(item.walkId).\(item.kind.rawValue)")
            try harness.outbox.succeed(id: item.id)
        }
        XCTAssertEqual(delivered, ["a.create", "a.samples", "b.create", "a.finish", "b.samples", "b.finish"], "walk order by id, interleaved by id")
        XCTAssertEqual(try harness.outbox.pendingCount(), 0)
        XCTAssertNil(try harness.outbox.earliestAttempt())
    }

    func testBackingOffHeadDoesNotBlockAnotherWalk() throws {
        let harness = try Harness()
        let now = harness.clock.now()
        try harness.recordWalk(id: "a", samples: 1)
        try harness.recordWalk(id: "b", samples: 1)
        try harness.outbox.enqueueCreate(walkId: "a", request: WalkCreateRequest(clientWalkId: "a", startedAt: now), now: now)
        try harness.outbox.enqueueSamples(walkId: "a", now: now)
        try harness.outbox.enqueueCreate(walkId: "b", request: WalkCreateRequest(clientWalkId: "b", startedAt: now), now: now)

        let head = try XCTUnwrap(harness.outbox.next(now: now))
        XCTAssertEqual(head.walkId, "a")
        try harness.outbox.fail(id: head.id, error: "network", retryAt: now.addingTimeInterval(30))
        let next = try XCTUnwrap(harness.outbox.next(now: now))
        XCTAssertEqual(next.walkId, "b", "b's create is due; a's samples wait behind a's create")
        XCTAssertEqual(next.kind, .create)
        try harness.outbox.succeed(id: next.id)
        XCTAssertNil(try harness.outbox.next(now: now), "a is backing off")
        XCTAssertEqual(try harness.outbox.earliestAttempt(), now.addingTimeInterval(30))
        let retried = try XCTUnwrap(harness.outbox.next(now: now.addingTimeInterval(30)))
        XCTAssertEqual(retried.id, head.id)
        XCTAssertEqual(retried.attempts, 1)
        XCTAssertEqual(retried.lastError, "network")
    }

    func testSamplesAreSplitIntoBatchesOfTwoHundredWithoutGapsOrDuplicates() throws {
        let harness = try Harness()
        let now = harness.clock.now()
        // 199 accepted + 1 rejected trigger the auto batch in `append`; 251 more remain uncovered.
        try harness.recordWalk(id: "long", samples: 450, rejected: 1)
        XCTAssertEqual(try harness.outbox.items(walkId: "long").count, 2, "two full batches were queued by append")
        let window = PedometerWindow(steps: 600, since: now, until: now.addingTimeInterval(2250))
        let created = try harness.outbox.enqueueSamples(walkId: "long", now: now, pedometer: window)
        XCTAssertEqual(created, 1)
        let items = try harness.outbox.items(walkId: "long")
        let batches = items.compactMap { $0.decodeBatch() }
        XCTAssertEqual(batches.map { $0.samples.count }, [200, 200, 51])
        let seqs = batches.flatMap { $0.samples.map(\.seq) }
        XCTAssertEqual(seqs, Array(0..<451), "every kept sample exactly once, in order, rejected ones included")
        XCTAssertEqual(batches.compactMap(\.pedometer).count, 1, "the pedometer window rides on the last batch only")
        XCTAssertEqual(batches.last?.pedometer?.steps, 600)
        XCTAssertEqual(try harness.outbox.enqueueSamples(walkId: "long", now: now), 0, "nothing uncovered is left")
        XCTAssertEqual(try harness.outbox.enqueueSamples(walkId: "long", now: now, onlyFullBatches: true), 0)
    }

    func testOnlyFullBatchesLeavesTheRemainder() throws {
        let harness = try Harness()
        try harness.recordWalk(id: "w", samples: 250)
        XCTAssertEqual(try harness.outbox.items(walkId: "w").count, 1)
        XCTAssertEqual(try harness.outbox.enqueueSamples(walkId: "w", now: harness.clock.now(), onlyFullBatches: true), 0)
        XCTAssertEqual(try harness.outbox.enqueueSamples(walkId: "w", now: harness.clock.now()), 1)
        XCTAssertEqual(try harness.outbox.items(walkId: "w").last?.decodeBatch()?.samples.count, 50)
    }

    func testDropWalkRemovesOnlyThatWalk() throws {
        let harness = try Harness()
        let now = harness.clock.now()
        try harness.recordWalk(id: "a", samples: 1)
        try harness.recordWalk(id: "b", samples: 1)
        try harness.outbox.enqueueCreate(walkId: "a", request: WalkCreateRequest(clientWalkId: "a", startedAt: now), now: now)
        try harness.outbox.enqueueSamples(walkId: "a", now: now)
        try harness.outbox.enqueueCreate(walkId: "b", request: WalkCreateRequest(clientWalkId: "b", startedAt: now), now: now)
        XCTAssertEqual(try harness.outbox.dropWalk(walkId: "a"), 2)
        XCTAssertEqual(try harness.outbox.items().map(\.walkId), ["b"])
    }

    func testPayloadIsTheWireBody() throws {
        let harness = try Harness()
        let now = harness.clock.now()
        try harness.recordWalk(id: "w", samples: 1)
        let request = WalkCreateRequest(clientWalkId: "w", startedAt: now, deviceInfo: DeviceInfo(model: "iPhone14,5"))
        try harness.outbox.enqueueCreate(walkId: "w", request: request, now: now)
        let item = try XCTUnwrap(harness.outbox.next(now: now))
        let text = String(data: item.payload, encoding: .utf8) ?? ""
        XCTAssertEqual(text, #"{"clientWalkId":"w","deviceInfo":{"model":"iPhone14,5"},"startedAt":"2026-09-07T10:00:00.000Z"}"#)
    }
}
