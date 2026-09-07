import Foundation

/// Injectable "now" so token expiry, the faction lock and export timeouts are testable (mirrors the API's
/// `lib/time.ts`). Shadows `Swift.Clock` by name inside modules that import `Core`, as plan.md names it.
public protocol Clock: Sendable {
    func now() -> Date
}

public struct SystemClock: Clock {
    public init() {}

    public func now() -> Date { Date() }
}
