import Foundation

/// The six tabs of the shell (`docs/architecture.md` §4: Map · Walk · Capture · Collection · Factions · Profile;
/// plan.md 002 "Six tabs" resolves 001's five-tab deviation). Order of `allCases` is the tab bar order.
public enum AppTab: String, CaseIterable, Identifiable, Sendable, Codable {
    case map
    case walk
    case capture
    case collection
    case factions
    case profile

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .map: "Map"
        case .walk: "Walk"
        case .capture: "Capture"
        case .collection: "Collection"
        case .factions: "Factions"
        case .profile: "Profile"
        }
    }

    /// SF Symbol for the tab item.
    public var systemImage: String {
        switch self {
        case .map: "map"
        case .walk: "figure.walk"
        case .capture: "camera.viewfinder"
        case .collection: "books.vertical"
        case .factions: "flag.2.crossed"
        case .profile: "person.crop.circle"
        }
    }
}
