import Foundation

/// `GET /v1/factions` (data-model.md §2.3). `factions` is sorted by `sort`, then `id`, by the server;
/// `suggestedFactionId` is the faction with the fewest active members (ties → lowest id) and is never recomputed
/// on the client (plan.md Shared Semantics 5).
public struct FactionsResponse: Codable, Sendable, Equatable {
    public var factions: [Faction]
    public var suggestedFactionId: Int
    /// The window behind `activeMembers` (14), so the UI can say "active in the last N days" without a constant.
    public var activeWindowDays: Int

    public init(factions: [Faction], suggestedFactionId: Int, activeWindowDays: Int) {
        self.factions = factions
        self.suggestedFactionId = suggestedFactionId
        self.activeWindowDays = activeWindowDays
    }

    public func faction(id: Int?) -> Faction? {
        guard let id else { return nil }
        return factions.first { $0.id == id }
    }
}
