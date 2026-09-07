#if canImport(SwiftUI)
import SwiftUI

/// Client-side mirror of the `factions` seed (data-model.md §4.2, `docs/architecture.md` §1): Owls green,
/// Foxes amber, Deer blue. Names, emoji and colours are data on the server (`GET /v1/factions`, feature 002);
/// this enum only provides the palette and defaults until then. Ids match the seeded `factions.id`.
public enum Faction: Int, CaseIterable, Identifiable, Sendable, Codable {
    case owls = 1
    case foxes = 2
    case deer = 3

    public var id: Int { rawValue }

    public var slug: String {
        switch self {
        case .owls: "owls"
        case .foxes: "foxes"
        case .deer: "deer"
        }
    }

    public var name: String {
        switch self {
        case .owls: "Owls"
        case .foxes: "Foxes"
        case .deer: "Deer"
        }
    }

    public var emoji: String {
        switch self {
        case .owls: "🦉"
        case .foxes: "🦊"
        case .deer: "🦌"
        }
    }

    /// `factions.color_light` / `factions.color_dark` from the seed.
    public var palette: FactionPalette {
        switch self {
        case .owls: FactionPalette(lightHex: "#4CAF50", darkHex: "#2E7D32")
        case .foxes: FactionPalette(lightHex: "#FFC107", darkHex: "#FFA000")
        case .deer: FactionPalette(lightHex: "#2196F3", darkHex: "#1976D2")
        }
    }
}

/// A faction's two seed colours. `light` is the fill on light backgrounds (and the hex overlay fill at 0.3
/// opacity, `docs/architecture.md` §4 Map); `dark` is the stronger variant used on dark backgrounds and for text.
public struct FactionPalette: Hashable, Sendable {
    public let lightHex: String
    public let darkHex: String

    public init(lightHex: String, darkHex: String) {
        self.lightHex = lightHex
        self.darkHex = darkHex
    }

    public var light: Color { Color(hex: lightHex) ?? .gray }
    public var dark: Color { Color(hex: darkHex) ?? .gray }

    /// The colour to use for the given colour scheme.
    public func color(for scheme: ColorScheme) -> Color {
        scheme == .dark ? dark : light
    }

    /// Hex overlay fill: faction colour at the map's 0.3 opacity.
    public var overlayFill: Color { light.opacity(0.3) }
}

public extension Color {
    /// Parses `#RRGGBB` or `RRGGBB` (case-insensitive) into an sRGB colour; `nil` for anything else.
    init?(hex: String) {
        var digits = Substring(hex)
        if digits.hasPrefix("#") { digits = digits.dropFirst() }
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        self.init(
            .sRGB,
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255,
            opacity: 1
        )
    }
}

/// Non-faction colours used across screens.
public enum AppColors {
    /// Fill for unclaimed hexes and neutral chrome.
    public static var unclaimedHex: Color { Color(hex: "#9E9E9E") ?? .gray }
    /// Outline colour for contested hexes (pulsing/hatched in the map layer).
    public static var contestedOutline: Color { Color(hex: "#FF5722") ?? .orange }
}
#endif
