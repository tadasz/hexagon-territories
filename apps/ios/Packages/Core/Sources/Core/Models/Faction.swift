import Foundation

/// A faction as served by `GET /v1/factions` (data-model.md §2.3): names, emoji and colours are server data, so the
/// client renders whatever it receives instead of a hard-coded palette.
public struct Faction: Codable, Sendable, Equatable, Identifiable {
    public let id: Int
    public var slug: String
    public var name: String
    public var emoji: String
    /// `#RRGGBB`, the fill on light backgrounds.
    public var colorLight: String
    /// `#RRGGBB`, the stronger variant for dark backgrounds and text.
    public var colorDark: String
    public var sort: Int
    public var stats: FactionStats

    public init(
        id: Int,
        slug: String,
        name: String,
        emoji: String,
        colorLight: String,
        colorDark: String,
        sort: Int,
        stats: FactionStats
    ) {
        self.id = id
        self.slug = slug
        self.name = name
        self.emoji = emoji
        self.colorLight = colorLight
        self.colorDark = colorDark
        self.sort = sort
        self.stats = stats
    }
}
