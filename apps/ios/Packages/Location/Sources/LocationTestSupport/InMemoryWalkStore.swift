import CoreTestSupport
import Foundation
import H3Kit
import Location
import TerritoryRules

/// `WalkStore` in memory, recording every call so tests can assert what reached persistence. `failing` makes every
/// call throw (the "storage fails" edge case).
public final class InMemoryWalkStore: WalkStore, @unchecked Sendable {
    public struct StoredWalk: Equatable, Sendable {
        public var clientWalkId: String
        public var startedAt: Date
        public var samples: [RecordedSample] = []
        public var progress = WalkProgress()
        public var finish: WalkFinishInput?
        public var progressUpdates = 0
    }

    public struct StoreError: Error {
        public init() {}
    }

    private let state: Locked<(walks: [String: StoredWalk], order: [String], failing: Bool)>

    public init(recovering: RecoverableWalk? = nil) {
        var walks: [String: StoredWalk] = [:]
        var order: [String] = []
        if let recovering {
            var walk = StoredWalk(clientWalkId: recovering.clientWalkId, startedAt: recovering.startedAt)
            walk.progress = recovering.progress
            walks[recovering.clientWalkId] = walk
            order.append(recovering.clientWalkId)
        }
        state = Locked((walks: walks, order: order, failing: false))
        recoveringPoints = recovering?.points ?? []
    }

    private let recoveringPoints: [LatLng]

    public var failing: Bool {
        get { state.value.failing }
        set { state.withLock { $0.failing = newValue } }
    }

    public var walks: [StoredWalk] {
        let value = state.value
        return value.order.compactMap { value.walks[$0] }
    }

    public func walk(_ id: String) -> StoredWalk? { state.value.walks[id] }

    public func createWalk(clientWalkId: String, startedAt: Date) throws {
        try state.withLock { state in
            if state.failing { throw StoreError() }
            state.walks[clientWalkId] = StoredWalk(clientWalkId: clientWalkId, startedAt: startedAt)
            state.order.append(clientWalkId)
        }
    }

    public func append(_ sample: RecordedSample, walkId: String) throws {
        try state.withLock { state in
            if state.failing { throw StoreError() }
            state.walks[walkId]?.samples.append(sample)
        }
    }

    public func updateProgress(_ progress: WalkProgress, walkId: String) throws {
        try state.withLock { state in
            if state.failing { throw StoreError() }
            state.walks[walkId]?.progress = progress
            state.walks[walkId]?.progressUpdates += 1
        }
    }

    public func markFinished(_ input: WalkFinishInput) throws {
        try state.withLock { state in
            if state.failing { throw StoreError() }
            state.walks[input.clientWalkId]?.finish = input
            state.walks[input.clientWalkId]?.progress = input.progress
        }
    }

    public func recordingWalk() throws -> RecoverableWalk? {
        let (walk, failing) = state.withLock { state -> (StoredWalk?, Bool) in
            (state.order.compactMap { state.walks[$0] }.first { $0.finish == nil }, state.failing)
        }
        if failing { throw StoreError() }
        guard let walk else { return nil }
        let points = walk.samples.isEmpty ? recoveringPoints : walk.samples.filter(\.accepted).map(\.sample.coordinate)
        return RecoverableWalk(clientWalkId: walk.clientWalkId, startedAt: walk.startedAt, progress: walk.progress, points: points)
    }
}
