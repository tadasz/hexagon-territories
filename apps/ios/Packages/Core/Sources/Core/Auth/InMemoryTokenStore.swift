import Foundation

/// `TokenStore` that keeps the pair in memory — for previews, tests and the simulator without a Keychain.
public final class InMemoryTokenStore: TokenStore, @unchecked Sendable {
    private let lock = NSLock()
    private var pair: TokenPair?

    public init(_ pair: TokenPair? = nil) {
        self.pair = pair
    }

    public func load() throws -> TokenPair? {
        lock.withLock { pair }
    }

    public func save(_ pair: TokenPair) throws {
        lock.withLock { self.pair = pair }
    }

    public func clear() throws {
        lock.withLock { pair = nil }
    }
}
