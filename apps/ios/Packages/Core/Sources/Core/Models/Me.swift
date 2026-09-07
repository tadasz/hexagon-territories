import Foundation

/// The signed-in player's profile (`contracts/openapi.yaml` `Me`, data-model.md §2.2 and §6). Never carries the
/// e-mail address. `factionChangeAvailableAt` is the only source of the faction-change lock on the client
/// (plan.md Shared Semantics 6); `suggestedFactionId` is computed by the server (Shared Semantics 5).
public struct Me: Codable, Sendable, Equatable, Identifiable {
    public enum Role: String, Codable, Sendable, Equatable {
        case player
        case tester
        case admin
    }

    public let id: String
    public var displayName: String
    public var factionId: Int?
    public var factionChangedAt: Date?
    public var factionChangeAvailableAt: Date?
    public var xp: Int
    public var level: Int
    public var role: Role
    public var createdAt: Date
    public var suggestedFactionId: Int

    public init(
        id: String,
        displayName: String,
        factionId: Int?,
        factionChangedAt: Date?,
        factionChangeAvailableAt: Date?,
        xp: Int,
        level: Int,
        role: Role,
        createdAt: Date,
        suggestedFactionId: Int
    ) {
        self.id = id
        self.displayName = displayName
        self.factionId = factionId
        self.factionChangedAt = factionChangedAt
        self.factionChangeAvailableAt = factionChangeAvailableAt
        self.xp = xp
        self.level = level
        self.role = role
        self.createdAt = createdAt
        self.suggestedFactionId = suggestedFactionId
    }

    /// True once the player has picked a faction; the tab bar is gated on this (research.md R12).
    public var hasFaction: Bool { factionId != nil }
}
