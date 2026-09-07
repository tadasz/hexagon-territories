import Core
import Foundation

/// Scriptable `WalksService` for the sync coordinator, the view models and the adapter tests. Every call is
/// recorded in order (`calls`); results come from per-operation queues whose last element repeats, so a test can
/// script "fail once, then succeed". Set `gate` to make the next call suspend until `release()` (cancellation tests).
public final class FakeWalksService: WalksService, @unchecked Sendable {
    public enum Call: Equatable, Sendable {
        case create(WalkCreateRequest)
        case samples(walkId: String, SampleBatchRequest)
        case finish(walkId: String, WalkFinishRequest)
        case list(cursor: String?, limit: Int?)
        case walk(id: String)
    }

    private struct State: Sendable {
        var calls: [Call] = []
        var createResults: [Result<WalkCreated, any Error>] = []
        var samplesResults: [Result<SampleBatchResult, any Error>] = []
        var finishResults: [Result<WalkSummary, any Error>] = []
        var listResults: [Result<WalkListPage, any Error>] = []
        var walkResults: [Result<WalkSummary, any Error>] = []
        var gated = false
        var waiters: [CheckedContinuation<Void, Never>] = []
    }

    private let state: Locked<State>

    public init() {
        state = Locked(State())
    }

    public var calls: [Call] { state.value.calls }

    public var createCalls: [WalkCreateRequest] {
        calls.compactMap { if case let .create(request) = $0 { request } else { nil } }
    }

    public var samplesCalls: [(walkId: String, batch: SampleBatchRequest)] {
        calls.compactMap { if case let .samples(walkId, batch) = $0 { (walkId, batch) } else { nil } }
    }

    public var finishCalls: [(walkId: String, request: WalkFinishRequest)] {
        calls.compactMap { if case let .finish(walkId, request) = $0 { (walkId, request) } else { nil } }
    }

    // MARK: Scripting

    public var createResults: [Result<WalkCreated, any Error>] {
        get { state.value.createResults }
        set { state.withLock { $0.createResults = newValue } }
    }

    public var samplesResults: [Result<SampleBatchResult, any Error>] {
        get { state.value.samplesResults }
        set { state.withLock { $0.samplesResults = newValue } }
    }

    public var finishResults: [Result<WalkSummary, any Error>] {
        get { state.value.finishResults }
        set { state.withLock { $0.finishResults = newValue } }
    }

    public var listResults: [Result<WalkListPage, any Error>] {
        get { state.value.listResults }
        set { state.withLock { $0.listResults = newValue } }
    }

    public var walkResults: [Result<WalkSummary, any Error>] {
        get { state.value.walkResults }
        set { state.withLock { $0.walkResults = newValue } }
    }

    /// While true, every call suspends before answering until `release()`.
    public var gate: Bool {
        get { state.value.gated }
        set {
            state.withLock { $0.gated = newValue }
            if !newValue { release() }
        }
    }

    /// Resumes every suspended call.
    public func release() {
        let waiters = state.withLock { state -> [CheckedContinuation<Void, Never>] in
            let waiters = state.waiters
            state.waiters = []
            return waiters
        }
        waiters.forEach { $0.resume() }
    }

    // MARK: WalksService

    public func createWalk(_ request: WalkCreateRequest) async throws -> WalkCreated {
        try await perform(.create(request), queue: \.createResults) {
            WalkCreated(walkId: "server-\(request.clientWalkId)", clientWalkId: request.clientWalkId, startedAt: request.startedAt)
        }
    }

    public func uploadSamples(walkId: String, _ batch: SampleBatchRequest) async throws -> SampleBatchResult {
        try await perform(.samples(walkId: walkId, batch), queue: \.samplesResults) {
            SampleBatchResult(
                stored: batch.samples.count,
                duplicates: 0,
                accepted: batch.samples.map(\.seq),
                rejected: [],
                sampleCount: batch.samples.count
            )
        }
    }

    public func finishWalk(walkId: String, _ request: WalkFinishRequest) async throws -> WalkSummary {
        try await perform(.finish(walkId: walkId, request), queue: \.finishResults) {
            Fixtures.walkSummary(walkId: walkId, endedAt: request.endedAt)
        }
    }

    public func listWalks(cursor: String?, limit: Int?) async throws -> WalkListPage {
        try await perform(.list(cursor: cursor, limit: limit), queue: \.listResults) {
            WalkListPage(items: [], nextCursor: nil)
        }
    }

    public func walk(id: String) async throws -> WalkSummary {
        try await perform(.walk(id: id), queue: \.walkResults) {
            Fixtures.walkSummary(walkId: id)
        }
    }

    // MARK: Private

    private func perform<T: Sendable>(
        _ call: Call,
        queue: WritableKeyPath<State, [Result<T, any Error>]>,
        fallback: () -> T
    ) async throws -> T {
        let gated = state.withLock { state -> Bool in
            state.calls.append(call)
            return state.gated
        }
        if gated {
            await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                let stillGated = state.withLock { state -> Bool in
                    if state.gated { state.waiters.append(continuation) }
                    return state.gated
                }
                if !stillGated { continuation.resume() }
            }
        }
        try Task.checkCancellation()
        let result = state.withLock { state -> Result<T, any Error>? in
            if state[keyPath: queue].count > 1 {
                return state[keyPath: queue].removeFirst()
            }
            return state[keyPath: queue].first
        }
        if let result { return try result.get() }
        return fallback()
    }
}
