import Foundation
import H3Kit

/// One cell's weekly reckoning — exactly `docs/territory-rules.md` "Weekly reckoning" (plan.md item 9).
///
/// `strength' = strength × DECAY + Σ cappedMeters + Σ bonusMeters` per faction; factions whose new strength is
/// below `Rules.minRetainedStrengthM` are dropped. Ownership follows the table: nobody ≥ `MIN_STRENGTH_M` →
/// unclaimed; no incumbent (or an incumbent that fell below the minimum) → the unique strongest faction ≥ minimum,
/// unclaimed on a tie; an incumbent ≥ minimum keeps the cell unless a single challenger reaches
/// `incumbent × (1 + HYSTERESIS)`; an exact tie at the top keeps the incumbent. Pure: idempotency is the job's concern.
public func reckonWeek(_ input: ReckonInput) -> ReckonResult {
    var strengths: [Int: Double] = [:]
    for strength in input.strengths {
        strengths[strength.factionId, default: 0] += strength.strength * Rules.decay
    }
    for contribution in input.contributions {
        strengths[contribution.factionId, default: 0] += contribution.cappedMeters
    }
    for bonus in input.bonuses {
        strengths[bonus.factionId, default: 0] += bonus.meters
    }
    strengths = strengths.filter { $0.value >= Rules.minRetainedStrengthM }

    let owner = decideOwner(incumbent: input.owner, strengths: strengths)
    let flipped = owner != input.owner
    return ReckonResult(
        strengths: strengths
            .map { FactionStrength(factionId: $0.key, strength: $0.value) }
            .sorted { $0.factionId < $1.factionId },
        owner: owner,
        flipped: flipped,
        event: flipped ? OwnershipEvent(from: input.owner, to: owner) : nil
    )
}

private func decideOwner(incumbent: Int?, strengths: [Int: Double]) -> Int? {
    let eligible = strengths.filter { $0.value >= Rules.minStrengthM }
    guard !eligible.isEmpty else { return nil }

    // An incumbent that fell below the minimum has lost its claim and is treated as absent.
    let incumbentStrength = incumbent.flatMap { eligible[$0] }
    guard let incumbent, let incumbentStrength else {
        return uniqueLeader(among: eligible)
    }

    let threshold = incumbentStrength * (1 + Rules.hysteresis)
    let clearing = eligible.filter { $0.key != incumbent && $0.value >= threshold }
    guard !clearing.isEmpty else { return incumbent }
    // A single strongest challenger takes the cell; challengers tied at the top leave the incumbent in place.
    return uniqueLeader(among: clearing) ?? incumbent
}

/// The faction with the strictly highest strength, or `nil` on an exact tie (or when empty).
private func uniqueLeader(among strengths: [Int: Double]) -> Int? {
    guard let top = strengths.values.max() else { return nil }
    let leaders = strengths.filter { $0.value == top }.keys
    return leaders.count == 1 ? leaders.first : nil
}
