import Core
import Foundation
import H3Kit
import TerritoryRules

/// The walk state machine (research.md R16, plan.md Shared Semantics 2/11):
///
/// ```
/// idle → starting → recording ⇄ paused → finishing → finished(WalkFinishInput)
///                 ↘ failed(WalkFailure)
/// ```
///
/// - `start` acquires the source (When-In-Use must already be granted), records the walk in the `WalkStore` and
///   consumes `updates()`; every fix goes through `PathRecorder` (throttle + shared filter), is stored, and — when
///   accepted — extends `HexMetersEstimator` and feeds `AutoPauseDetector`; the `LivePath` mirror is refreshed.
/// - `tick` (called by the owner every few seconds and on every fix) drives auto-pause without fixes and the 6 h
///   auto-end; the same walk never produces two `finished` states.
/// - `stop` ends the walk with `endedAt = now`; the source is stopped before the store is updated.
/// - `recover` finishes a walk the store still holds as recording (relaunch after a kill) with `endedAt` = its last
///   kept sample, without starting the source.
public actor WalkTracker {
    public enum State: Sendable, Equatable {
        case idle
        case starting
        case recording
        case paused
        case finishing
        case finished(WalkFinishInput)
        case failed(WalkFailure)

        public var isActive: Bool {
            switch self {
            case .starting, .recording, .paused, .finishing: true
            default: false
            }
        }
    }

    public enum WalkFailure: Error, Sendable, Equatable {
        case notAuthorized
        case sourceUnavailable(String)
        case storeFailed(String)
    }

    public struct Configuration: Sendable, Equatable {
        public var throttle: PathRecorder.Throttle
        /// Auto-end after this much wall time (6 h).
        public var maxDurationS: TimeInterval
        public var pauseAfterS: TimeInterval
        public var minMoveM: Double

        public init(
            throttle: PathRecorder.Throttle = .standard,
            maxDurationS: TimeInterval = 6 * 3600,
            pauseAfterS: TimeInterval = AutoPauseDetector.defaultPauseAfterS,
            minMoveM: Double = AutoPauseDetector.defaultMinMoveM
        ) {
            self.throttle = throttle
            self.maxDurationS = maxDurationS
            self.pauseAfterS = pauseAfterS
            self.minMoveM = minMoveM
        }
    }

    public private(set) var state: State = .idle
    /// Every state change, for the view model (one consumer; the newest 32 are buffered).
    public nonisolated let stateChanges: AsyncStream<State>

    private let continuation: AsyncStream<State>.Continuation
    private let source: any LocationSource
    private let pedometer: (any PedometerSource)?
    private let store: any WalkStore
    private let livePath: LivePath?
    private let clock: any Clock
    private let configuration: Configuration

    private var recorder: PathRecorder
    private var estimator: HexMetersEstimator
    private var pauseDetector: AutoPauseDetector
    private var clientWalkId: String?
    private var startedAt: Date?
    private var lastSampleTs: Date?
    private var sampleCount = 0
    private var acceptedCount = 0
    private var storeWarning = false
    private var consumeTask: Task<Void, Never>?

    public init(
        source: any LocationSource,
        pedometer: (any PedometerSource)? = nil,
        store: any WalkStore,
        livePath: LivePath? = nil,
        clock: any Clock = SystemClock(),
        configuration: Configuration = Configuration()
    ) {
        let (stream, continuation) = AsyncStream<State>.makeStream(bufferingPolicy: .bufferingNewest(32))
        stateChanges = stream
        self.continuation = continuation
        self.source = source
        self.pedometer = pedometer
        self.store = store
        self.livePath = livePath
        self.clock = clock
        self.configuration = configuration
        recorder = PathRecorder(throttle: configuration.throttle)
        estimator = HexMetersEstimator()
        pauseDetector = AutoPauseDetector(pauseAfterS: configuration.pauseAfterS, minMoveM: configuration.minMoveM)
    }

    deinit {
        continuation.finish()
    }

    public var currentWalkId: String? { clientWalkId }
    public var currentStartedAt: Date? { startedAt }

    public var progress: WalkProgress {
        WalkProgress(
            distanceM: estimator.distanceM,
            movingSeconds: Int(pauseDetector.movingSeconds.rounded(.down)),
            hexCount: estimator.hexCount,
            isPaused: pauseDetector.isPaused,
            hexEstimates: estimator.snapshot(),
            currentCell: estimator.currentCell,
            lastSampleTs: lastSampleTs,
            sampleCount: sampleCount,
            acceptedCount: acceptedCount
        )
    }

    public var snapshot: PathSnapshot {
        PathSnapshot(
            points: estimator.points,
            hexEstimates: estimator.snapshot(),
            currentCell: estimator.currentCell,
            currentCellMeters: estimator.currentCellMeters,
            distanceM: estimator.distanceM,
            movingSeconds: Int(pauseDetector.movingSeconds.rounded(.down)),
            hexCount: estimator.hexCount,
            isPaused: pauseDetector.isPaused,
            isRecording: state == .recording || state == .paused,
            storeWarning: storeWarning
        )
    }

    // MARK: Inputs

    /// Starts a walk. Throws `WalkFailure` (and moves to `failed`) when the source cannot start; a store failure
    /// does not stop the walk (it is reported through `PathSnapshot.storeWarning`).
    @discardableResult
    public func start(clientWalkId id: String = UUID().uuidString.lowercased()) async throws -> String {
        guard !state.isActive else {
            return clientWalkId ?? id
        }
        setState(.starting)
        let now = clock.now()
        resetWalk(clientWalkId: id, startedAt: now)
        do {
            try source.start()
        } catch let error as LocationSourceError {
            let failure: WalkFailure = error == .notAuthorized ? .notAuthorized : .sourceUnavailable("\(error)")
            setState(.failed(failure))
            throw failure
        } catch {
            let failure = WalkFailure.sourceUnavailable("\(error)")
            setState(.failed(failure))
            throw failure
        }
        do {
            try store.createWalk(clientWalkId: id, startedAt: now)
        } catch {
            storeWarning = true
        }
        pauseDetector.start(at: now)
        setState(.recording)
        consume()
        await publish()
        return id
    }

    /// Ends the walk now. Returns the finish input (also delivered as `.finished`), or `nil` when no walk is active.
    @discardableResult
    public func stop() async -> WalkFinishInput? {
        guard state == .recording || state == .paused else {
            if case let .finished(input) = state { return input }
            return nil
        }
        return await finish(reason: .client, endedAt: clock.now())
    }

    /// One fix from the source (public so tests and replay tools can feed fixes deterministically).
    public func ingest(_ fix: LocationFix) async {
        guard state == .recording || state == .paused else { return }
        guard let recorded = recorder.record(fix), let walkId = clientWalkId else { return }
        sampleCount += 1
        lastSampleTs = recorded.sample.ts
        do {
            try store.append(recorded, walkId: walkId)
        } catch {
            storeWarning = true
        }
        if recorded.accepted {
            acceptedCount += 1
            do {
                try estimator.add(recorded.sample.coordinate)
            } catch {
                // H3 rejected the coordinate (out of range): keep the sample stored, skip the estimate.
            }
            apply(pauseDetector.observe(recorded.sample.coordinate, at: clock.now(), isStationary: recorded.isStationary))
            do {
                try store.updateProgress(progress, walkId: walkId)
            } catch {
                storeWarning = true
            }
        }
        await publish()
        await checkAutoEnd()
    }

    /// Periodic input (every few seconds while a walk is active): auto-pause without fixes and the 6 h auto-end.
    public func tick() async {
        guard state == .recording || state == .paused else { return }
        apply(pauseDetector.tick(now: clock.now()))
        await publish()
        await checkAutoEnd()
    }

    /// Finishes a walk the store still holds as recording (relaunch). Only when idle; never touches the source.
    public func recover() throws -> WalkFinishInput? {
        guard state == .idle, let walk = try store.recordingWalk() else { return nil }
        let input = WalkFinishInput(
            clientWalkId: walk.clientWalkId,
            startedAt: walk.startedAt,
            endedAt: walk.progress.lastSampleTs ?? walk.startedAt,
            reason: .recovered,
            progress: walk.progress,
            steps: nil,
            points: walk.points
        )
        try store.markFinished(input)
        return input
    }

    /// Back to `idle` after the owner consumed a `finished`/`failed` state.
    public func reset() async {
        guard !state.isActive else { return }
        resetWalk(clientWalkId: nil, startedAt: nil)
        setState(.idle)
        await publish()
    }

    // MARK: Private

    private func consume() {
        consumeTask?.cancel()
        let stream = source.updates()
        consumeTask = Task { [weak self] in
            do {
                for try await fix in stream {
                    guard let self else { return }
                    await self.ingest(fix)
                }
                await self?.sourceEnded(error: nil)
            } catch {
                await self?.sourceEnded(error: error)
            }
        }
    }

    private func sourceEnded(error: (any Error)?) async {
        guard state == .recording || state == .paused else { return }
        _ = await finish(reason: .sourceLost, endedAt: clock.now())
        if let error {
            // Delivered after `.finished` so the walk is kept; the view model tells the player why it stopped.
            continuation.yield(.failed(error as? WalkFailure ?? .sourceUnavailable("\(error)")))
        }
    }

    private func checkAutoEnd() async {
        guard state == .recording || state == .paused, let startedAt else { return }
        let now = clock.now()
        if now.timeIntervalSince(startedAt) >= configuration.maxDurationS {
            _ = await finish(reason: .autoEnd, endedAt: now)
        }
    }

    private func finish(reason: WalkFinishInput.Reason, endedAt: Date) async -> WalkFinishInput? {
        guard state == .recording || state == .paused, let clientWalkId, let startedAt else { return nil }
        setState(.finishing)
        consumeTask?.cancel()
        consumeTask = nil
        source.stop()
        _ = pauseDetector.tick(now: endedAt)
        let steps = await pedometer?.steps(from: startedAt, to: endedAt)
        let input = WalkFinishInput(
            clientWalkId: clientWalkId,
            startedAt: startedAt,
            endedAt: endedAt,
            reason: reason,
            progress: progress,
            steps: steps,
            points: estimator.points
        )
        do {
            try store.markFinished(input)
        } catch {
            storeWarning = true
        }
        setState(.finished(input))
        await publish()
        return input
    }

    private func apply(_ transition: AutoPauseDetector.Transition?) {
        switch transition {
        case .paused: setState(.paused)
        case .resumed: setState(.recording)
        case nil: break
        }
    }

    private func resetWalk(clientWalkId id: String?, startedAt: Date?) {
        clientWalkId = id
        self.startedAt = startedAt
        lastSampleTs = nil
        sampleCount = 0
        acceptedCount = 0
        storeWarning = false
        recorder = PathRecorder(throttle: configuration.throttle)
        estimator.reset()
        pauseDetector = AutoPauseDetector(pauseAfterS: configuration.pauseAfterS, minMoveM: configuration.minMoveM)
    }

    private func setState(_ new: State) {
        guard new != state else { return }
        state = new
        continuation.yield(new)
    }

    private func publish() async {
        guard let livePath else { return }
        let snapshot = self.snapshot
        await MainActor.run { livePath.apply(snapshot) }
    }
}
