import Core
import Foundation

public final class FakeFactionsService: FactionsService, @unchecked Sendable {
    private let state: Locked<(result: Result<FactionsResponse, any Error>, calls: Int)>

    public init(result: Result<FactionsResponse, any Error> = .success(Fixtures.factionsResponse())) {
        state = Locked((result: result, calls: 0))
    }

    public var result: Result<FactionsResponse, any Error> {
        get { state.value.result }
        set { state.withLock { $0.result = newValue } }
    }

    public var calls: Int { state.value.calls }

    public func factions() async throws -> FactionsResponse {
        let result = state.withLock { state -> Result<FactionsResponse, any Error> in
            state.calls += 1
            return state.result
        }
        return try result.get()
    }
}
