import Foundation

/// Whether the player may change faction now, derived only from `Me.factionChangeAvailableAt` (plan.md Shared
/// Semantics 6: the 30-day rule lives on the server; the client never hard-codes it).
public enum FactionChangeLock: Equatable, Sendable {
    case free
    case locked(until: Date)

    public init(nextChangeAt: Date?, now: Date) {
        if let nextChangeAt, nextChangeAt > now {
            self = .locked(until: nextChangeAt)
        } else {
            self = .free
        }
    }

    public init(me: Me?, clock: any Clock) {
        self.init(nextChangeAt: me?.factionChangeAvailableAt, now: clock.now())
    }

    public var isLocked: Bool {
        if case .locked = self { return true }
        return false
    }

    public var until: Date? {
        if case let .locked(until) = self { return until }
        return nil
    }

    /// Player-facing text for a lock, `nil` when free. The date is spelled out so the player knows when to return.
    public func message(relativeTo now: Date, locale: Locale = .current) -> String? {
        guard case let .locked(until) = self else { return nil }
        let day = until.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted, locale: locale))
        let days = Int((until.timeIntervalSince(now) / 86_400).rounded(.up))
        switch days {
        case ...1: return "You can change your faction again tomorrow (\(day))."
        default: return "You can change your faction again in \(days) days (\(day))."
        }
    }
}
