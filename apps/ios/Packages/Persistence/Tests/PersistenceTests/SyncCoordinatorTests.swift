import Core
import CoreTestSupport
import Foundation
import Location
@testable import Persistence
import TerritoryRules
import XCTest

/// The outbox drain with `FakeWalksService` and `FakeClock` (T020, SC-004): exactly-once delivery with retries.
final class SyncCoordinatorTests: XCTestCase {
    private var harness: Harness!
    private var service: FakeWalksService!
    private var sleeps: Locked<[TimeInterval]>!

    override func setUpWithError() throws {
        harness = try Harness()
        service = FakeWalksService()
        sleeps = Locked([])
    }

    private func makeCoordinator() -> SyncCoordinator {
        let sleeps = sleeps!
        return SyncCoordinator(
            repository: harness.repository,
            outbox: harness.outbox,
            service: service,
            clock: harness.clock,
            backoff: Backoff(seed: 1),
            sleeper: { delay in
                sleeps.withLock { $0.append(delay) }
                // Never wakes on its own in tests; the test drives `drain()` and the clock.
                try await Task.sleep(for: .seconds(100_000))
            },
            autoKick: false
        )
    }

    private func assertDrain(_ sync: SyncCoordinator, _ expected: Int, _ message: String = "", file: StaticString = #filePath, line: UInt = #line) async {
        let processed = await sync.drain()
        XCTAssertEqual(processed, expected, message, file: file, line: line)
    }

    private func assertFlush(
        _ sync: SyncCoordinator,
        walkId: String,
        _ expected: Int,
        _ message: String = "",
        file: StaticString = #filePath,
        line: UInt = #line
    ) async throws {
        let created = try await sync.flushSamples(walkId: walkId)
        XCTAssertEqual(created, expected, message, file: file, line: line)
    }

    private func recordAndFinish(_ id: String, samples: Int = 3, steps: Int? = nil) throws -> WalkFinishInput {
        let start = harness.clock.now()
        let recorded = try harness.recordWalk(id: id, startedAt: start, samples: samples)
        let endedAt = start.addingTimeInterval(Double(samples) * 5)
        let input = harness.finishInput(id: id, startedAt: start, endedAt: endedAt, points: recorded.map(\.sample.coordinate), steps: steps)
        try harness.repository.markFinished(input)
        return input
    }

    // MARK: Happy path

    func testCreateSamplesFinishAreDeliveredInOrderAndTheSummaryStored() async throws {
        let sync = makeCoordinator()
        let events = Locked<[SyncCoordinator.Event]>([])
        let collector = Task { for await event in sync.events { events.withLock { $0.append(event) } } }
        let start = harness.clock.now()
        try await sync.walkStarted(clientWalkId: "w1", startedAt: start, deviceInfo: DeviceInfo(model: "iPhone14,5"))
        let input = try recordAndFinish("w1", samples: 3, steps: 40)
        try await sync.walkFinished(input)
        let processed = await sync.drain()

        XCTAssertEqual(processed, 3)
        XCTAssertEqual(service.calls.count, 3)
        guard case let .create(request) = service.calls[0] else { return XCTFail("create first") }
        XCTAssertEqual(request.clientWalkId, "w1")
        XCTAssertEqual(request.deviceInfo?.model, "iPhone14,5")
        guard case let .samples(walkId, batch) = service.calls[1] else { return XCTFail("samples second") }
        XCTAssertEqual(walkId, "server-w1", "the server id from the create answer")
        XCTAssertEqual(batch.samples.map(\.seq), [0, 1, 2])
        XCTAssertEqual(batch.pedometer?.steps, 40)
        guard case let .finish(finishWalkId, finishRequest) = service.calls[2] else { return XCTFail("finish last") }
        XCTAssertEqual(finishWalkId, "server-w1")
        XCTAssertEqual(finishRequest.endedAt, input.endedAt)
        XCTAssertEqual(finishRequest.pedometerTotal, 40)

        let walk = try XCTUnwrap(harness.repository.localWalk(id: "w1"))
        XCTAssertEqual(walk.syncState, .synced)
        XCTAssertEqual(walk.serverId, "server-w1")
        XCTAssertEqual(walk.summary?.walkId, "server-w1")
        XCTAssertEqual(try harness.outbox.pendingCount(), 0)
        try? await Task.sleep(for: .milliseconds(20))
        collector.cancel()
        let received = events.value
        XCTAssertEqual(received.first, .walkCreated(clientWalkId: "w1", serverId: "server-w1"))
        XCTAssertTrue(received.contains { if case .walkSynced("w1", _) = $0 { true } else { false } }, "\(received)")
        XCTAssertEqual(received.last, .drained(processed: 3))
    }

    func testFinishWithoutStepsSendsNoPedometer() async throws {
        let sync = makeCoordinator()
        try await sync.walkStarted(clientWalkId: "w", startedAt: harness.clock.now())
        try await sync.walkFinished(try recordAndFinish("w"))
        await sync.drain()
        XCTAssertNil(service.samplesCalls.first?.batch.pedometer)
        XCTAssertNil(service.finishCalls.first?.request.pedometerTotal)
    }

    // MARK: Retries

    func testNetworkErrorRetriesWithBackoffAndNoDuplicate() async throws {
        service.createResults = [.failure(OfflineError()), .success(WalkCreated(walkId: "srv", clientWalkId: "w", startedAt: harness.clock.now()))]
        let sync = makeCoordinator()
        try await sync.walkStarted(clientWalkId: "w", startedAt: harness.clock.now())
        try await sync.walkFinished(try recordAndFinish("w"))

        await assertDrain(sync, 1, "the create failed; the rest waits behind it")
        XCTAssertEqual(service.createCalls.count, 1)
        let head = try XCTUnwrap(harness.outbox.items(walkId: "w").first)
        XCTAssertEqual(head.attempts, 1)
        XCTAssertEqual(head.lastError, "network")
        let delay = head.nextAttemptAt.timeIntervalSince(harness.clock.now())
        XCTAssertGreaterThanOrEqual(delay, 1.6)
        XCTAssertLessThanOrEqual(delay, 2.4, "first retry ≈ 2 s ± 20 %")
        XCTAssertEqual(sleeps.value.last ?? -1, delay, accuracy: 0.001, "the wake-up sleeps until the retry")
        XCTAssertEqual(try harness.repository.localWalk(id: "w")?.syncState, .pending)

        await assertDrain(sync, 0, "not due yet")
        harness.clock.advance(by: 3)
        await assertDrain(sync, 3)
        XCTAssertEqual(service.createCalls.count, 2, "retried exactly once more")
        XCTAssertEqual(service.samplesCalls.count, 1)
        XCTAssertEqual(service.finishCalls.count, 1)
        XCTAssertEqual(try harness.repository.localWalk(id: "w")?.syncState, .synced)
    }

    func testServerErrorsAreTransientAndBackoffGrows() async throws {
        service.samplesResults = [.failure(APIError.unexpected(code: "HTTP_503", status: 503))]
        let sync = makeCoordinator()
        try await sync.walkStarted(clientWalkId: "w", startedAt: harness.clock.now())
        try await sync.walkFinished(try recordAndFinish("w"))
        var delays: [TimeInterval] = []
        for _ in 0..<4 {
            await sync.drain()
            let head = try XCTUnwrap(harness.outbox.items(walkId: "w").first)
            XCTAssertEqual(head.kind, .samples)
            delays.append(head.nextAttemptAt.timeIntervalSince(harness.clock.now()))
            harness.clock.set(head.nextAttemptAt)
        }
        XCTAssertEqual(delays.count, 4)
        for (index, delay) in delays.enumerated() {
            let base = Backoff.baseDelay(attempt: index + 1)
            XCTAssertGreaterThanOrEqual(delay, base * 0.8 - 1e-6, "attempt \(index + 1)")
            XCTAssertLessThanOrEqual(delay, base * 1.2 + 1e-6, "attempt \(index + 1)")
        }
        XCTAssertEqual(service.samplesCalls.count, 4)
        XCTAssertEqual(service.finishCalls.count, 0, "the finish never overtakes the batch")
    }

    func testRateLimitWaitsRetryAfterSeconds() async throws {
        let stored = SampleBatchResult(stored: 3, duplicates: 0, accepted: [0, 1, 2], rejected: [], sampleCount: 3)
        service.samplesResults = [.failure(APIError.rateLimited(retryAfterS: 30)), .success(stored)]
        let sync = makeCoordinator()
        try await sync.walkStarted(clientWalkId: "w", startedAt: harness.clock.now())
        try await sync.walkFinished(try recordAndFinish("w"))
        await sync.drain()
        let head = try XCTUnwrap(harness.outbox.items(walkId: "w").first)
        XCTAssertEqual(head.kind, .samples)
        XCTAssertEqual(head.nextAttemptAt, harness.clock.now().addingTimeInterval(30), "exactly retryAfterS")
        XCTAssertEqual(head.lastError, "RATE_LIMITED")
        harness.clock.advance(by: 29)
        await assertDrain(sync, 0)
        harness.clock.advance(by: 1)
        await assertDrain(sync, 2)
        XCTAssertEqual(service.samplesCalls.count, 2)
        XCTAssertEqual(try harness.repository.localWalk(id: "w")?.syncState, .synced)
    }

    func testQuotaWithTinyRetryAfterWaitsAtLeastFiveSeconds() async throws {
        service.samplesResults = [.failure(APIError.sampleQuotaExceeded(retryAfterS: 1))]
        let sync = makeCoordinator()
        try await sync.walkStarted(clientWalkId: "w", startedAt: harness.clock.now())
        try await sync.walkFinished(try recordAndFinish("w"))
        await sync.drain()
        let head = try XCTUnwrap(harness.outbox.items(walkId: "w").first)
        XCTAssertEqual(head.nextAttemptAt, harness.clock.now().addingTimeInterval(5))
    }

    // MARK: Permanent failures

    func testOverlapMarksTheWalkFailedDropsItsItemsAndTheNextWalkProceeds() async throws {
        service.createResults = [
            .failure(APIError.walkOverlap(activeWalkId: "srv-other")),
            .success(WalkCreated(walkId: "srv-2", clientWalkId: "w2", startedAt: harness.clock.now())),
        ]
        let sync = makeCoordinator()
        let events = Locked<[SyncCoordinator.Event]>([])
        let collector = Task { for await event in sync.events { events.withLock { $0.append(event) } } }
        try await sync.walkStarted(clientWalkId: "w1", startedAt: harness.clock.now())
        try await sync.walkFinished(try recordAndFinish("w1"))
        harness.clock.advance(by: 3600)
        try await sync.walkStarted(clientWalkId: "w2", startedAt: harness.clock.now())
        try await sync.walkFinished(try recordAndFinish("w2"))

        let processed = await sync.drain()
        XCTAssertEqual(processed, 4, "w1 create (failed) + w2 create/samples/finish")
        let failed = try XCTUnwrap(harness.repository.localWalk(id: "w1"))
        XCTAssertEqual(failed.syncState, .failed)
        XCTAssertEqual(failed.syncError, "WALK_OVERLAP")
        XCTAssertEqual(try harness.outbox.items(walkId: "w1").count, 0, "w1's samples and finish were dropped")
        XCTAssertEqual(try harness.repository.localWalk(id: "w2")?.syncState, .synced)
        XCTAssertEqual(service.samplesCalls.map(\.walkId), ["srv-2"], "no sample of w1 was ever sent")
        try? await Task.sleep(for: .milliseconds(20))
        collector.cancel()
        XCTAssertTrue(events.value.contains(.walkFailed(clientWalkId: "w1", code: "WALK_OVERLAP")), "\(events.value)")
    }

    func testNotActiveOnSamplesDropsTheRestAndRefreshesTheWalk() async throws {
        service.samplesResults = [.failure(APIError.walkNotActive)]
        service.walkResults = [.success(Fixtures.walkSummary(walkId: "server-w", clientWalkId: "w", finishReason: .autofinish))]
        let sync = makeCoordinator()
        try await sync.walkStarted(clientWalkId: "w", startedAt: harness.clock.now())
        try await sync.walkFinished(try recordAndFinish("w"))
        await sync.drain()
        XCTAssertEqual(service.calls.count, 3, "create, samples, GET walk")
        guard case .walk(id: "server-w") = service.calls[2] else { return XCTFail("expected a refresh, got \(service.calls[2])") }
        XCTAssertEqual(service.finishCalls.count, 0, "the queued finish was dropped")
        XCTAssertEqual(try harness.outbox.pendingCount(), 0)
        let walk = try XCTUnwrap(harness.repository.localWalk(id: "w"))
        XCTAssertEqual(walk.syncState, .synced)
        XCTAssertEqual(walk.summary?.finishReason, .autofinish)
    }

    func testNotActiveRefreshFailureMarksFailed() async throws {
        service.samplesResults = [.failure(APIError.walkNotActive)]
        service.walkResults = [.failure(OfflineError())]
        let sync = makeCoordinator()
        try await sync.walkStarted(clientWalkId: "w", startedAt: harness.clock.now())
        try await sync.walkFinished(try recordAndFinish("w"))
        await sync.drain()
        XCTAssertEqual(try harness.repository.localWalk(id: "w")?.syncState, .failed)
        XCTAssertEqual(try harness.repository.localWalk(id: "w")?.syncError, "WALK_NOT_ACTIVE")
    }

    func testSessionEndedHaltsTheDrainWithoutDropping() async throws {
        service.createResults = [.failure(APIError.tokenExpired)]
        let sync = makeCoordinator()
        try harness.repository.createWalk(clientWalkId: "w1", startedAt: harness.clock.now())
        try harness.repository.createWalk(clientWalkId: "w2", startedAt: harness.clock.now().addingTimeInterval(10))
        try await sync.walkStarted(clientWalkId: "w1", startedAt: harness.clock.now())
        try await sync.walkStarted(clientWalkId: "w2", startedAt: harness.clock.now().addingTimeInterval(10))
        await assertDrain(sync, 1, "stops after the first 401")
        XCTAssertEqual(service.createCalls.count, 1)
        XCTAssertEqual(try harness.outbox.pendingCount(), 2, "nothing dropped")
        XCTAssertEqual(try harness.repository.localWalk(id: "w1")?.syncState, .pending)
        XCTAssertEqual(try harness.outbox.items(walkId: "w1").first?.lastError, "TOKEN_EXPIRED")
    }

    func testOrphanItemsWithoutALocalWalkAreDropped() async throws {
        let sync = makeCoordinator()
        try await sync.walkStarted(clientWalkId: "ghost", startedAt: harness.clock.now())
        await assertDrain(sync, 1)
        XCTAssertTrue(service.calls.isEmpty, "nothing is sent for a walk the store no longer has")
        XCTAssertEqual(try harness.outbox.pendingCount(), 0)
    }

    // MARK: SC-004: interrupted drains

    func testInterruptedDrainResumesWithoutResendingDeliveredItems() async throws {
        let sync = makeCoordinator()
        try await sync.walkStarted(clientWalkId: "w", startedAt: harness.clock.now())
        try await sync.walkFinished(try recordAndFinish("w"))
        let service = self.service!
        // Every call waits at the gate: let the create through, hold the samples batch in flight.
        service.gate = true
        let drainTask = Task { await sync.drain() }
        for _ in 0..<400 where service.calls.count < 1 {
            try await Task.sleep(for: .milliseconds(5))
        }
        XCTAssertEqual(service.calls.count, 1)
        service.release()
        for _ in 0..<400 where service.calls.count < 2 {
            try await Task.sleep(for: .milliseconds(5))
        }
        XCTAssertEqual(service.calls.count, 2, "create delivered, samples in flight")
        for _ in 0..<400 where (try? harness.outbox.items(walkId: "w").first?.kind) != .samples {
            try await Task.sleep(for: .milliseconds(5))
        }
        drainTask.cancel()
        service.gate = false
        _ = await drainTask.value
        XCTAssertEqual(try harness.outbox.items(walkId: "w").map(\.kind), [.samples, .finish], "the create is gone, the in-flight batch stays")

        // Second drain finishes the job; the create is never re-sent and each remaining item is sent once.
        await assertDrain(sync, 2)
        XCTAssertEqual(service.createCalls.count, 1, "exactly one create")
        XCTAssertEqual(service.samplesCalls.count, 2, "the cancelled batch was re-sent once (idempotent by seq)")
        XCTAssertEqual(service.finishCalls.count, 1)
        XCTAssertEqual(try harness.outbox.pendingCount(), 0)
        XCTAssertEqual(try harness.repository.localWalk(id: "w")?.syncState, .synced)
    }

    func testConcurrentDrainsCoalesce() async throws {
        let sync = makeCoordinator()
        try await sync.walkStarted(clientWalkId: "w", startedAt: harness.clock.now())
        try await sync.walkFinished(try recordAndFinish("w"))
        service.gate = true
        let first = Task { await sync.drain() }
        for _ in 0..<200 where service.calls.isEmpty {
            try await Task.sleep(for: .milliseconds(5))
        }
        let second = await sync.drain()
        XCTAssertEqual(second, 0, "a drain in flight: the second call only requests a re-run")
        service.gate = false
        let processed = await first.value
        XCTAssertEqual(processed, 3)
        XCTAssertEqual(service.calls.count, 3, "no item was sent twice")
    }

    // MARK: Timer

    func testFlushSamplesQueuesOnlyNewSamples() async throws {
        let sync = makeCoordinator()
        let start = harness.clock.now()
        try await sync.walkStarted(clientWalkId: "w", startedAt: start)
        try harness.recordWalk(id: "w", startedAt: start, samples: 3)
        try await assertFlush(sync, walkId: "w", 1)
        try await assertFlush(sync, walkId: "w", 0, "nothing new")
        await sync.drain()
        XCTAssertEqual(service.samplesCalls.first?.batch.samples.map(\.seq), [0, 1, 2])
        let more = RecordedSample(sample: Sample(seq: 3, ts: start.addingTimeInterval(15), lat: 54.9002, lon: 23.9, hAcc: 8), accepted: true, reason: nil)
        try harness.repository.append(more, walkId: "w")
        try await assertFlush(sync, walkId: "w", 1)
        await sync.drain()
        XCTAssertEqual(service.samplesCalls.last?.batch.samples.map(\.seq), [3])
    }

    func testRecordingTimerFlushesEveryInterval() async throws {
        let ticks = Locked(0)
        let sync = SyncCoordinator(
            repository: harness.repository,
            outbox: harness.outbox,
            service: service,
            clock: harness.clock,
            backoff: Backoff(seed: 1),
            sleeper: { delay in
                if delay == 60 {
                    let count = ticks.withLock { $0 += 1; return $0 }
                    if count > 2 { try await Task.sleep(for: .seconds(100_000)) }
                    return
                }
                try await Task.sleep(for: .seconds(100_000))
            },
            autoKick: false
        )
        let start = harness.clock.now()
        try await sync.walkStarted(clientWalkId: "w", startedAt: start)
        try harness.recordWalk(id: "w", startedAt: start, samples: 2)
        await sync.startRecordingTimer(walkId: "w")
        for _ in 0..<200 where ticks.value < 3 {
            try await Task.sleep(for: .milliseconds(5))
        }
        try? await Task.sleep(for: .milliseconds(30))
        await sync.stopRecordingTimer()
        await sync.drain()
        XCTAssertEqual(service.samplesCalls.count, 1, "two timer ticks, but only one batch had new samples")
        XCTAssertEqual(service.samplesCalls.first?.batch.samples.count, 2)
    }
}
