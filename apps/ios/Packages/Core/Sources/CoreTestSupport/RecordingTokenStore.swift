import Core
import Foundation

/// `TokenStore` that records calls and can be made to throw.
public final class RecordingTokenStore: TokenStore, @unchecked Sendable {
    private struct State: Sendable {
        var pair: TokenPair?
        var loadError: (any Error)?
        var saveError: (any Error)?
        var clearError: (any Error)?
        var saved: [TokenPair] = []
        var loadCount = 0
        var clearCount = 0
    }

    private let state: Locked<State>

    public init(_ pair: TokenPair? = nil) {
        state = Locked(State(pair: pair))
    }

    public var pair: TokenPair? {
        get { state.value.pair }
        set { state.withLock { $0.pair = newValue } }
    }

    public var loadError: (any Error)? {
        get { state.value.loadError }
        set { state.withLock { $0.loadError = newValue } }
    }

    public var saveError: (any Error)? {
        get { state.value.saveError }
        set { state.withLock { $0.saveError = newValue } }
    }

    public var clearError: (any Error)? {
        get { state.value.clearError }
        set { state.withLock { $0.clearError = newValue } }
    }

    public var saved: [TokenPair] { state.value.saved }
    public var loadCount: Int { state.value.loadCount }
    public var clearCount: Int { state.value.clearCount }

    public func load() throws -> TokenPair? {
        let (pair, error) = state.withLock { state -> (TokenPair?, (any Error)?) in
            state.loadCount += 1
            return (state.pair, state.loadError)
        }
        if let error { throw error }
        return pair
    }

    public func save(_ pair: TokenPair) throws {
        let error = state.withLock { state -> (any Error)? in
            if state.saveError == nil {
                state.pair = pair
                state.saved.append(pair)
            }
            return state.saveError
        }
        if let error { throw error }
    }

    public func clear() throws {
        let error = state.withLock { state -> (any Error)? in
            state.clearCount += 1
            if state.clearError == nil { state.pair = nil }
            return state.clearError
        }
        if let error { throw error }
    }
}
