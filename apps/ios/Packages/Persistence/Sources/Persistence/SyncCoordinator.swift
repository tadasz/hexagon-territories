import Core
import Foundation
import Location

/// Drains the outbox (research.md R17, plan.md Shared Semantics 12–13, FR-006):
///
/// - items are processed FIFO per walk (`OutboxQueue.next`), one at a time, and deleted only after the server
///   answered — an interrupted drain resumes without re-sending a delivered item, and re-sending an undelivered one
///   is harmless because every request is idempotent (`clientWalkId`, `(walkId, seq)`, finish);
/// - transient failures (network, 5xx, 408, 429, session ended) reschedule the item with `Backoff`, or with the
///   server's `retryAfterS` (at least 5 s) on a 429, and never drop anything;
/// - permanent failures (any other 4xx: `WALK_OVERLAP`, `FACTION_REQUIRED`, `INVALID_ENDED_AT`, …) mark the walk
///   `failed` with the code and delete its remaining items; later walks continue;
/// - `WALK_NOT_ACTIVE` on a samples batch drops the walk's remaining items and refreshes the walk with `GET`;
/// - a successful finish stores the server summary and marks the walk `synced` (`Event.walkSynced`).
///
/// Kicks: `kick()` from the app (foreground, `NWPathMonitor`, `BGAppRefreshTask`), the 60 s recording timer
/// (`startRecordingTimer`), and the coordinator's own wake-up when a back-off expires.
public actor SyncCoordinator {
    public enum Event: Sendable, Equatable {
        case walkCreated(clientWalkId: String, serverId: String)
        case walkSynced(clientWalkId: String, WalkSummary)
        case walkFailed(clientWalkId: String, code: String)
        case drained(processed: Int)
    }

    public typealias Sleeper = @Sendable (TimeInterval) async throws -> Void

    /// Minimum wait after a 429, even when the server says less (plan.md Shared Semantics 12).
    public static let minRetryAfterS: TimeInterval = 5
    /// Batch interval while a walk records (plan.md Shared Semantics 4).
    public static let recordingBatchInterval: TimeInterval = 60

    public nonisolated let events: AsyncStream<Event>

    private let continuation: AsyncStream<Event>.Continuation
    private let repository: GRDBWalkRepository
    private let outbox: OutboxQueue
    private let service: any WalksService
    private let clock: any Clock
    private let sleeper: Sleeper
    private let autoKick: Bool
    private var backoff: Backoff
    private var isDraining = false
    private var rerunRequested = false
    private var wakeTask: Task<Void, Never>?
    private var recordingTimer: Task<Void, Never>?

    public init(
        repository: GRDBWalkRepository,
        outbox: OutboxQueue,
        service: any WalksService,
        clock: any Clock = SystemClock(),
        backoff: Backoff = Backoff(),
        sleeper: @escaping Sleeper = { try await Task.sleep(for: .seconds($0)) },
        autoKick: Bool = true
    ) {
        let (stream, continuation) = AsyncStream<Event>.makeStream(bufferingPolicy: .bufferingNewest(64))
        events = stream
        self.continuation = continuation
        self.repository = repository
        self.outbox = outbox
        self.service = service
        self.clock = clock
        self.backoff = backoff
        self.sleeper = sleeper
        self.autoKick = autoKick
    }

    deinit {
        continuation.finish()
        wakeTask?.cancel()
        recordingTimer?.cancel()
    }

    // MARK: Walk lifecycle → outbox

    /// Queues the creation request (offline-safe) and starts draining.
    public func walkStarted(clientWalkId: String, startedAt: Date, deviceInfo: DeviceInfo? = nil) throws {
        try outbox.enqueueCreate(
            walkId: clientWalkId,
            request: WalkCreateRequest(clientWalkId: clientWalkId, startedAt: startedAt, deviceInfo: deviceInfo),
            now: clock.now()
        )
        kick()
    }

    /// Queues the kept samples not yet in a batch (the 60 s timer) and drains.
    @discardableResult
    public func flushSamples(walkId: String) throws -> Int {
        let created = try outbox.enqueueSamples(walkId: walkId, now: clock.now())
        if created > 0 { kick() }
        return created
    }

    /// Queues the remaining samples and the finish request for a walk the tracker ended, then drains.
    public func walkFinished(_ input: WalkFinishInput) throws {
        stopRecordingTimer()
        let now = clock.now()
        let window = input.steps.map { PedometerWindow(steps: $0, since: input.startedAt, until: input.endedAt) }
        try outbox.enqueueSamples(walkId: input.clientWalkId, now: now, pedometer: window)
        try outbox.enqueueFinish(
            walkId: input.clientWalkId,
            request: WalkFinishRequest(endedAt: input.endedAt, pedometerTotal: input.steps),
            now: now
        )
        kick()
    }

    /// Every `interval` seconds while the walk records: batch the new samples and drain.
    public func startRecordingTimer(walkId: String, interval: TimeInterval = SyncCoordinator.recordingBatchInterval) {
        stopRecordingTimer()
        let sleeper = self.sleeper
        recordingTimer = Task { [weak self] in
            while !Task.isCancelled {
                guard (try? await sleeper(interval)) != nil else { return }
                guard let self else { return }
                _ = try? await self.flushSamples(walkId: walkId)
            }
        }
    }

    public func stopRecordingTimer() {
        recordingTimer?.cancel()
        recordingTimer = nil
    }

    // MARK: Draining

    /// Starts a drain in the background (coalesced: a running drain re-runs once more when kicked). With
    /// `autoKick == false` (tests) nothing happens and the owner calls `drain()` itself.
    public func kick() {
        guard autoKick else { return }
        Task { [weak self] in
            await self?.drain()
        }
    }

    /// Processes every due item; single in-flight drain (a concurrent call requests one more pass and returns 0).
    /// Returns the number of items processed (delivered or rescheduled).
    @discardableResult
    public func drain() async -> Int {
        guard !isDraining else {
            rerunRequested = true
            return 0
        }
        isDraining = true
        defer { isDraining = false }
        var processed = 0
        repeat {
            rerunRequested = false
            while !Task.isCancelled, let item = (try? outbox.next(now: clock.now())) ?? nil {
                let outcome = await process(item)
                processed += 1
                if outcome == .halt { break }
            }
        } while rerunRequested && !Task.isCancelled
        continuation.yield(.drained(processed: processed))
        scheduleWake()
        return processed
    }

    public func pendingCount() -> Int {
        (try? outbox.pendingCount()) ?? 0
    }

    // MARK: Private

    private enum Outcome: Equatable {
        case delivered
        case rescheduled
        case dropped
        /// Stop this drain (cancellation, or a failure that would repeat for every item).
        case halt
    }

    private func process(_ item: OutboxItem) async -> Outcome {
        guard let walk = try? repository.localWalk(id: item.walkId) else {
            try? outbox.succeed(id: item.id)
            return .dropped
        }
        do {
            switch item.kind {
            case .create:
                let request = try JSONCoding.decoder().decode(WalkCreateRequest.self, from: item.payload)
                let created = try await service.createWalk(request)
                try repository.setServerId(created.walkId, walkId: walk.id)
                try outbox.succeed(id: item.id)
                continuation.yield(.walkCreated(clientWalkId: walk.id, serverId: created.walkId))
            case .samples:
                guard let serverId = walk.serverId else { throw MissingServerId() }
                let batch = try JSONCoding.decoder().decode(SampleBatchRequest.self, from: item.payload)
                _ = try await service.uploadSamples(walkId: serverId, batch)
                try outbox.succeed(id: item.id)
            case .finish:
                guard let serverId = walk.serverId else { throw MissingServerId() }
                let request = try JSONCoding.decoder().decode(WalkFinishRequest.self, from: item.payload)
                let summary = try await service.finishWalk(walkId: serverId, request)
                try repository.storeSummary(summary, walkId: walk.id)
                try outbox.succeed(id: item.id)
                continuation.yield(.walkSynced(clientWalkId: walk.id, summary))
            }
            return .delivered
        } catch is CancellationError {
            return .halt
        } catch APIError.walkNotActive where item.kind == .samples {
            // The server finished it already (autofinish/supersede): drop what is left and adopt its summary.
            _ = try? outbox.dropWalk(walkId: walk.id)
            await refresh(walk: walk)
            return .dropped
        } catch let error as APIError where !error.isTransient {
            let code = error.code ?? "HTTP"
            try? repository.markFailed(walkId: walk.id, code: code)
            _ = try? outbox.dropWalk(walkId: walk.id)
            continuation.yield(.walkFailed(clientWalkId: walk.id, code: code))
            return .dropped
        } catch let error as MissingServerId {
            // Cannot happen with FIFO ordering; keep the item and retry later rather than lose it.
            try? outbox.fail(id: item.id, error: error.description, retryAt: clock.now().addingTimeInterval(backoff.delay(attempt: item.attempts + 1)))
            return .rescheduled
        } catch {
            let apiError = error as? APIError
            let delay = apiError?.retryAfterS.map { max(Self.minRetryAfterS, TimeInterval($0)) }
                ?? backoff.delay(attempt: item.attempts + 1)
            try? outbox.fail(id: item.id, error: apiError?.code ?? "network", retryAt: clock.now().addingTimeInterval(delay))
            // A dead session fails every request the same way: wait for the next kick instead of burning attempts.
            return apiError?.endsSession == true ? .halt : .rescheduled
        }
    }

    private func refresh(walk: LocalWalk) async {
        guard let serverId = walk.serverId, let summary = try? await service.walk(id: serverId) else {
            try? repository.markFailed(walkId: walk.id, code: "WALK_NOT_ACTIVE")
            continuation.yield(.walkFailed(clientWalkId: walk.id, code: "WALK_NOT_ACTIVE"))
            return
        }
        if summary.status == .active {
            try? repository.markFailed(walkId: walk.id, code: "WALK_NOT_ACTIVE")
            continuation.yield(.walkFailed(clientWalkId: walk.id, code: "WALK_NOT_ACTIVE"))
            return
        }
        try? repository.storeSummary(summary, walkId: walk.id)
        continuation.yield(.walkSynced(clientWalkId: walk.id, summary))
    }

    /// After a drain, sleep until the earliest head item is due, then drain again.
    private func scheduleWake() {
        wakeTask?.cancel()
        wakeTask = nil
        guard let earliest = try? outbox.earliestAttempt() else { return }
        guard autoKick else {
            // Tests observe the requested delay through the sleeper without a self-driven re-drain.
            let sleeper = self.sleeper
            let delay = max(0.5, earliest.timeIntervalSince(clock.now()))
            wakeTask = Task { try? await sleeper(delay) }
            return
        }
        let delay = max(0.5, earliest.timeIntervalSince(clock.now()))
        let sleeper = self.sleeper
        wakeTask = Task { [weak self] in
            guard (try? await sleeper(delay)) != nil, !Task.isCancelled else { return }
            await self?.drain()
        }
    }

    private struct MissingServerId: Error, CustomStringConvertible {
        var description: String { "walk has no server id yet" }
    }
}
