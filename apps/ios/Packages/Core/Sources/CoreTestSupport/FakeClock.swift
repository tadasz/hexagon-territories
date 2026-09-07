import Core
import Foundation

/// Settable clock for expiry, lock and timeout tests.
public final class FakeClock: Clock, @unchecked Sendable {
    private let current: Locked<Date>

    public init(now: Date = Fixtures.now) {
        current = Locked(now)
    }

    public func now() -> Date { current.value }

    public func set(_ date: Date) {
        current.value = date
    }

    public func advance(by seconds: TimeInterval) {
        current.withLock { $0 = $0.addingTimeInterval(seconds) }
    }
}
