import Core
import CoreTestSupport
import Foundation
import H3Kit
import Location
import LocationTestSupport
import TerritoryRules
import XCTest

/// The tracker state machine with `FakeLocationSource`, `FakeClock` and `InMemoryWalkStore` (T017).
@MainActor
final class WalkTrackerTests: XCTestCase {
    private var source: FakeLocationSource!
    private var store: InMemoryWalkStore!
    private var clock: FakeClock!
    private var livePath: LivePath!
    private let t0 = Date(timeIntervalSince1970: 1_788_768_000) // 2026-09-07T08:00:00Z, the fixtures' start

    override func setUp() async throws {
        source = FakeLocationSource()
        store = InMemoryWalkStore()
        clock = FakeClock(now: t0)
        livePath = LivePath()
    }

    private func makeTracker(
        throttle: PathRecorder.Throttle = .disabled,
        pedometer: (any PedometerSource)? = nil,
        store: (any WalkStore)? = nil
    ) -> WalkTracker {
        WalkTracker(
            source: source,
            pedometer: pedometer,
            store: store ?? self.store,
            livePath: livePath,
            clock: clock,
            configuration: WalkTracker.Configuration(throttle: throttle)
        )
    }

    private func north(_ metres: Double) -> LocationFix {
        LocationFix(timestamp: clock.now(), lat: 54.9 + metres / 111_195, lon: 23.9, hAcc: 8, speed: 1.4)
    }

    private func assertState(
        _ tracker: WalkTracker,
        _ expected: WalkTracker.State,
        _ message: String = "",
        file: StaticString = #filePath,
        line: UInt = #line
    ) async {
        let actual = await tracker.state
        XCTAssertEqual(actual, expected, message, file: file, line: line)
    }

    private func waitForState(_ tracker: WalkTracker, _ predicate: @escaping (WalkTracker.State) -> Bool) async {
        for _ in 0..<200 where !predicate(await tracker.state) {
            try? await Task.sleep(for: .milliseconds(5))
        }
    }

    // MARK: Start / store

    func testStartRecordsTheWalkAndStartsTheSource() async throws {
        let tracker = makeTracker()
        let id = try await tracker.start(clientWalkId: "walk-1")
        XCTAssertEqual(id, "walk-1")
        await assertState(tracker, .recording)
        XCTAssertEqual(source.startCalls, 1)
        XCTAssertEqual(store.walks.map(\.clientWalkId), ["walk-1"])
        XCTAssertEqual(store.walk("walk-1")?.startedAt, t0)
        XCTAssertTrue(livePath.isRecording)
        XCTAssertTrue(livePath.waitingForGPS, "no accepted sample yet")
        let currentId = await tracker.currentWalkId
        XCTAssertEqual(currentId, "walk-1")
        let again = try await tracker.start(clientWalkId: "walk-2")
        XCTAssertEqual(again, "walk-1", "a second start is a no-op")
        await tracker.stop()
    }

    func testFixtureSamplesReachTheStoreWithTheFixtureVerdicts() async throws {
        let testCase = try WalkPathsFixture.load().caseNamed("noisy-zigzag")
        let tracker = makeTracker()
        try await tracker.start(clientWalkId: "zigzag")
        for sample in testCase.input.samples {
            clock.set(sample.ts)
            await tracker.ingest(sample.fix)
        }
        let stored = try XCTUnwrap(store.walk("zigzag"))
        XCTAssertEqual(stored.samples.map(\.sample.seq), testCase.input.samples.map(\.seq), "every kept sample stored, in order")
        XCTAssertEqual(stored.samples.filter(\.accepted).map(\.sample.seq), testCase.expected.acceptedSeqs)
        XCTAssertEqual(
            stored.samples.filter { !$0.accepted }.map { "\($0.sample.seq):\($0.reason?.rawValue ?? "")" },
            testCase.expected.rejected.map { "\($0.seq):\($0.reason)" }
        )
        let batch = try pathToHexMeters(acceptSamples(testCase.input.samples).accepted.map(\.coordinate))
        XCTAssertEqual(livePath.hexEstimates.map(\.cell), batch.map(\.cell))
        XCTAssertEqual(livePath.points.count, testCase.expected.acceptedSeqs.count)
        XCTAssertEqual(stored.progress.acceptedCount, testCase.expected.acceptedSeqs.count)
        XCTAssertEqual(stored.progress.sampleCount, testCase.input.samples.count)
        XCTAssertGreaterThan(stored.progressUpdates, 0)
        XCTAssertFalse(livePath.waitingForGPS)
        await assertState(tracker, .recording, "a zigzag at walking pace never pauses")

        let stopped = await tracker.stop()
        let input = try XCTUnwrap(stopped)
        XCTAssertEqual(input.reason, .client)
        XCTAssertEqual(input.progress.hexEstimates.map(\.cell), batch.map(\.cell))
        XCTAssertEqual(input.points.count, testCase.expected.acceptedSeqs.count)
        XCTAssertEqual(input.endedAt, testCase.input.samples.last?.ts)
        XCTAssertEqual(store.walk("zigzag")?.finish, input)
        XCTAssertEqual(source.stopCalls, 1)
        XCTAssertFalse(livePath.isRecording)
    }

    func testThrottleAppliesToStreamedFixes() async throws {
        let tracker = makeTracker(throttle: .standard)
        try await tracker.start(clientWalkId: "t")
        for second in 0..<12 {
            clock.set(t0.addingTimeInterval(Double(second)))
            await tracker.ingest(north(Double(second)))
        }
        XCTAssertEqual(store.walk("t")?.samples.map(\.sample.seq), [0, 1, 2], "1 m/s at 1 Hz keeps one fix per 5 s")
        await tracker.stop()
    }

    // MARK: Pause / resume

    func testStationaryThreeMinutesPausesAndMovementResumes() async throws {
        let tracker = makeTracker()
        try await tracker.start(clientWalkId: "p")
        await tracker.ingest(north(0))
        clock.advance(by: 100)
        await tracker.ingest(north(2))
        clock.advance(by: 80)
        await tracker.tick()
        await assertState(tracker, .paused)
        XCTAssertTrue(livePath.isPaused)
        XCTAssertEqual(livePath.movingSeconds, 180)
        XCTAssertEqual(store.walk("p")?.progress.isPaused, false, "progress is written on accepted samples")

        clock.advance(by: 300)
        await tracker.tick()
        XCTAssertEqual(livePath.movingSeconds, 180, "paused time is not moving time")
        clock.advance(by: 10)
        await tracker.ingest(north(30))
        await assertState(tracker, .recording)
        XCTAssertFalse(livePath.isPaused)
        XCTAssertEqual(store.walk("p")?.progress.isPaused, false)
        clock.advance(by: 60)
        await tracker.tick()
        XCTAssertEqual(livePath.movingSeconds, 240)
        await tracker.stop()
    }

    // MARK: Auto-end / stop / failure

    func testSixHoursAutoEndsTheWalkOnce() async throws {
        let tracker = makeTracker(pedometer: FakePedometer(steps: 4200))
        var states: [WalkTracker.State] = []
        let collector = Task { for await state in tracker.stateChanges { states.append(state) } }
        try await tracker.start(clientWalkId: "long")
        await tracker.ingest(north(0))
        clock.advance(by: 5 * 3600)
        await tracker.tick()
        await assertState(tracker, .paused, "no movement for 5 h: paused, not ended")
        clock.advance(by: 3600)
        await tracker.tick()
        let finalState = await tracker.state
        guard case let .finished(input) = finalState else {
            return XCTFail("expected finished, got \(finalState)")
        }
        XCTAssertEqual(input.reason, .autoEnd)
        XCTAssertEqual(input.endedAt, t0.addingTimeInterval(6 * 3600))
        XCTAssertEqual(input.steps, 4200)
        XCTAssertEqual(input.progress.movingSeconds, 180)
        XCTAssertEqual(source.stopCalls, 1)
        // Late inputs after the end change nothing.
        clock.advance(by: 60)
        await tracker.tick()
        await tracker.ingest(north(500))
        let afterEnd = await tracker.stop()
        XCTAssertEqual(afterEnd, input, "stop after auto-end returns the same input")
        try? await Task.sleep(for: .milliseconds(20))
        collector.cancel()
        XCTAssertEqual(states.filter { if case .finished = $0 { true } else { false } }.count, 1, "exactly one finished state")
        XCTAssertEqual(states.first, .starting)
    }

    func testStopFinishesWithEndedAtNow() async throws {
        let tracker = makeTracker()
        try await tracker.start(clientWalkId: "s")
        await tracker.ingest(north(0))
        clock.advance(by: 30)
        await tracker.ingest(north(40))
        clock.advance(by: 15)
        let stopped = await tracker.stop()
        let input = try XCTUnwrap(stopped)
        XCTAssertEqual(input.endedAt, t0.addingTimeInterval(45))
        XCTAssertEqual(input.startedAt, t0)
        XCTAssertEqual(input.progress.movingSeconds, 45)
        XCTAssertEqual(input.progress.distanceM, 40, accuracy: 0.5)
        XCTAssertNil(input.steps, "no pedometer")
        let second = await tracker.stop()
        XCTAssertEqual(second, input, "a second stop is idempotent")
        await tracker.reset()
        await assertState(tracker, .idle)
        XCTAssertEqual(livePath.points.count, 0)
    }

    func testNotAuthorizedSourceFailsTheStart() async {
        source.startError = .notAuthorized
        let tracker = makeTracker()
        do {
            try await tracker.start(clientWalkId: "denied")
            XCTFail("expected a failure")
        } catch {
            XCTAssertEqual(error as? WalkTracker.WalkFailure, .notAuthorized)
        }
        await assertState(tracker, .failed(.notAuthorized))
        XCTAssertTrue(store.walks.isEmpty, "no walk is created without permission")
    }

    func testSourceErrorMidWalkFinishesWithWhatWasRecorded() async throws {
        let tracker = makeTracker()
        try await tracker.start(clientWalkId: "lost")
        await tracker.ingest(north(0))
        clock.advance(by: 20)
        await tracker.ingest(north(30))
        source.end(throwing: LocationSourceError.notAuthorized)
        await waitForState(tracker) { if case .finished = $0 { true } else { false } }
        let finalState = await tracker.state
        guard case let .finished(input) = finalState else {
            return XCTFail("expected finished, got \(finalState)")
        }
        XCTAssertEqual(input.reason, .sourceLost)
        XCTAssertEqual(input.progress.acceptedCount, 2)
        XCTAssertNotNil(store.walk("lost")?.finish)
    }

    func testStreamedFixesAreConsumed() async throws {
        let tracker = makeTracker()
        try await tracker.start(clientWalkId: "stream")
        source.send(north(0))
        source.send(LocationFix(timestamp: t0.addingTimeInterval(5), lat: 54.9002, lon: 23.9, hAcc: 8))
        for _ in 0..<200 where (store.walk("stream")?.samples.count ?? 0) < 2 {
            try await Task.sleep(for: .milliseconds(5))
        }
        XCTAssertEqual(store.walk("stream")?.samples.count, 2)
        await tracker.stop()
    }

    func testStoreFailureKeepsTheWalkRunningAndWarns() async throws {
        store.failing = true
        let tracker = makeTracker()
        try await tracker.start(clientWalkId: "nostore")
        await assertState(tracker, .recording)
        await tracker.ingest(north(0))
        clock.advance(by: 10)
        await tracker.ingest(north(20))
        XCTAssertTrue(livePath.storeWarning)
        XCTAssertEqual(livePath.points.count, 2, "recording continues in memory")
        let stopped = await tracker.stop()
        let input = try XCTUnwrap(stopped)
        XCTAssertEqual(input.progress.acceptedCount, 2)
    }

    // MARK: Recovery

    func testRecoverFinishesAWalkLeftRecording() async throws {
        let progress = WalkProgress(
            distanceM: 321,
            movingSeconds: 400,
            hexCount: 2,
            hexEstimates: [HexMeters(cell: H3Index(string: "891f40dabb3ffff")!, meters: 321)],
            lastSampleTs: t0.addingTimeInterval(-3600),
            sampleCount: 80,
            acceptedCount: 79
        )
        let recovering = RecoverableWalk(
            clientWalkId: "crashed",
            startedAt: t0.addingTimeInterval(-4000),
            progress: progress,
            points: [LatLng(lat: 54.9, lon: 23.9), LatLng(lat: 54.901, lon: 23.9)]
        )
        let recoveringStore = InMemoryWalkStore(recovering: recovering)
        let tracker = makeTracker(store: recoveringStore)
        let recovered = try await tracker.recover()
        let input = try XCTUnwrap(recovered)
        XCTAssertEqual(input.reason, .recovered)
        XCTAssertEqual(input.clientWalkId, "crashed")
        XCTAssertEqual(input.endedAt, t0.addingTimeInterval(-3600), "the last kept sample")
        XCTAssertEqual(input.progress, progress)
        XCTAssertEqual(input.points.count, 2)
        XCTAssertNil(input.steps)
        XCTAssertNotNil(recoveringStore.walk("crashed")?.finish)
        let nothing = try await tracker.recover()
        XCTAssertNil(nothing, "nothing left to recover")
        await assertState(tracker, .idle)
        XCTAssertEqual(source.startCalls, 0, "recovery never touches the source")
    }

    func testRecoverWithoutSamplesUsesStart() async throws {
        let recovering = RecoverableWalk(clientWalkId: "empty", startedAt: t0.addingTimeInterval(-100), progress: WalkProgress(), points: [])
        let tracker = makeTracker(store: InMemoryWalkStore(recovering: recovering))
        let recovered = try await tracker.recover()
        let input = try XCTUnwrap(recovered)
        XCTAssertEqual(input.endedAt, t0.addingTimeInterval(-100))
        XCTAssertEqual(input.progress.distanceM, 0)
    }

    func testNothingToRecoverAndNoRecoveryWhileActive() async throws {
        let tracker = makeTracker()
        let idleRecovery = try await tracker.recover()
        XCTAssertNil(idleRecovery)
        try await tracker.start(clientWalkId: "active")
        let activeRecovery = try await tracker.recover()
        XCTAssertNil(activeRecovery, "an active tracker leaves the store alone")
        await tracker.stop()
    }
}
