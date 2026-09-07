import Foundation

/// Live statistics of one faction (data-model.md §2.3). Hex counts are zero until the first reckoning.
public struct FactionStats: Codable, Sendable, Equatable {
    public var members: Int
    /// Members who used the app within `FactionsResponse.activeWindowDays`.
    public var activeMembers: Int
    public var hexesOwnedR9: Int
    public var hexesOwnedR7: Int

    public init(members: Int, activeMembers: Int, hexesOwnedR9: Int, hexesOwnedR7: Int) {
        self.members = members
        self.activeMembers = activeMembers
        self.hexesOwnedR9 = hexesOwnedR9
        self.hexesOwnedR7 = hexesOwnedR7
    }

    public static let zero = FactionStats(members: 0, activeMembers: 0, hexesOwnedR9: 0, hexesOwnedR7: 0)
}
