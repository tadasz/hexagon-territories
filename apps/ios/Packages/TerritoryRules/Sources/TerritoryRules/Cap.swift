import Foundation
import H3Kit

/// Sums metres per `(cell, factionId, userId)` and caps each sum at `Rules.weeklyCapMPerPlayerPerCell`
/// (plan.md item 8). Bonuses are never passed through here. Output is sorted by cell, faction, user.
public func applyWeeklyCap(_ contributions: [Contribution]) -> [CappedContribution] {
    struct Key: Hashable {
        let cell: H3Index
        let factionId: Int
        let userId: String
    }

    var sums: [Key: Double] = [:]
    for contribution in contributions {
        let key = Key(cell: contribution.cell, factionId: contribution.factionId, userId: contribution.userId)
        sums[key, default: 0] += contribution.meters
    }

    return sums
        .map { key, meters in
            CappedContribution(
                cell: key.cell,
                factionId: key.factionId,
                userId: key.userId,
                meters: meters,
                cappedMeters: min(meters, Rules.weeklyCapMPerPlayerPerCell)
            )
        }
        .sorted { lhs, rhs in
            if lhs.cell != rhs.cell { return lhs.cell < rhs.cell }
            if lhs.factionId != rhs.factionId { return lhs.factionId < rhs.factionId }
            return lhs.userId < rhs.userId
        }
}
