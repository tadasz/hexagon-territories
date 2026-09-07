import Foundation

/// A tiny lock box so the fakes can be mutated by tests and read from actors under Swift 6 strict concurrency.
public final class Locked<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: Value

    public init(_ value: Value) {
        stored = value
    }

    public var value: Value {
        get { lock.withLock { stored } }
        set { lock.withLock { stored = newValue } }
    }

    public func withLock<R>(_ body: (inout Value) throws -> R) rethrows -> R {
        try lock.withLock { try body(&stored) }
    }
}
