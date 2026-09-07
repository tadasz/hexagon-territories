import Foundation

/// Parent ownership (res 8 → 5) from the owners of the child cells — plan.md item 10 /
/// `docs/territory-rules.md` "Parent ownership": `nil` entries are unclaimed children; fewer than
/// `Rules.parentMinClaimedChildren` claimed children → unclaimed; the faction with the most children owns the
/// parent if it is the unique leader and its share of claimed children exceeds `Rules.parentPlurality`.
public func deriveParentOwner(_ childOwners: [Int?]) -> Int? {
    var counts: [Int: Int] = [:]
    for case let owner? in childOwners {
        counts[owner, default: 0] += 1
    }
    let claimed = counts.values.reduce(0, +)
    guard claimed >= Rules.parentMinClaimedChildren, let top = counts.values.max() else { return nil }
    let leaders = counts.filter { $0.value == top }.keys
    guard leaders.count == 1, let leader = leaders.first else { return nil }
    return Double(top) / Double(claimed) > Rules.parentPlurality ? leader : nil
}
