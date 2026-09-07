import Foundation

/// The five tabs of the 001 shell (spec FR-007, plan.md deviation "five tabs"): Map · Walk · Capture · Collection ·
/// Profile. Factions arrives with feature 002. Order of `allCases` is the tab bar order.
public enum AppTab: String, CaseIterable, Identifiable, Sendable, Codable {
    case map
    case walk
    case capture
    case collection
    case profile

    public var id: String { rawValue }

    public var title: String {
        switch self {
        case .map: "Map"
        case .walk: "Walk"
        case .capture: "Capture"
        case .collection: "Collection"
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
        case .profile: "person.crop.circle"
        }
    }
}
