import Foundation

/// One card on the faction pick screen.
public struct FactionRow: Equatable, Sendable, Identifiable {
    public let faction: Faction
    /// The server's smallest faction ("Fewest active players" badge).
    public let isSuggested: Bool
    /// The player's current faction.
    public let isCurrent: Bool

    public var id: Int { faction.id }

    public init(faction: Faction, isSuggested: Bool, isCurrent: Bool) {
        self.faction = faction
        self.isSuggested = isSuggested
        self.isCurrent = isCurrent
    }
}

/// Pure presentation rules of the faction pick screen (spec US2/US4). The suggestion comes from
/// `FactionsResponse.suggestedFactionId` and is never recomputed here (plan.md Shared Semantics 5).
public enum FactionPickPresentation {
    public static let suggestedBadge = "Fewest active players"

    /// Cards sorted by `sort`, then `id`, with the suggestion and current flags applied.
    public static func rows(response: FactionsResponse, me: Me?) -> [FactionRow] {
        response.factions
            .sorted { lhs, rhs in
                if lhs.sort != rhs.sort { return lhs.sort < rhs.sort }
                return lhs.id < rhs.id
            }
            .map { faction in
                FactionRow(
                    faction: faction,
                    isSuggested: faction.id == response.suggestedFactionId,
                    isCurrent: faction.id == me?.factionId
                )
            }
    }

    /// The current faction when the player has one, otherwise the suggestion.
    public static func preselectedFactionId(response: FactionsResponse, me: Me?) -> Int {
        me?.factionId ?? response.suggestedFactionId
    }

    /// The first pick is free; afterwards only a *different* faction can be confirmed, and only while unlocked.
    public static func confirmEnabled(selected: Int?, currentFactionId: Int?, lock: FactionChangeLock) -> Bool {
        guard let selected else { return false }
        guard let currentFactionId else { return true }
        return selected != currentFactionId && !lock.isLocked
    }

    /// "12 members · 9 active (last 14 days) · 0 r9 / 0 r7 hexes"
    public static func statsLine(_ stats: FactionStats, activeWindowDays: Int) -> String {
        let members = stats.members == 1 ? "1 member" : "\(stats.members) members"
        return "\(members) · \(stats.activeMembers) active (last \(activeWindowDays) days) · "
            + "\(stats.hexesOwnedR9) r9 / \(stats.hexesOwnedR7) r7 hexes"
    }
}
