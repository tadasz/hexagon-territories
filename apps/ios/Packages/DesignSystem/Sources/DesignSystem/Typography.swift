#if canImport(SwiftUI)
import SwiftUI

/// Text styles used across feature packages. Computed properties (not stored globals) keep the type free of
/// global-actor isolation under Swift 6 strict concurrency.
public enum Typography {
    public static var screenTitle: Font { .system(.largeTitle, design: .rounded).weight(.bold) }
    public static var sectionTitle: Font { .system(.title3, design: .rounded).weight(.semibold) }
    public static var body: Font { .system(.body) }
    public static var caption: Font { .system(.caption) }
    /// Big numbers on the walk HUD (metres, XP).
    public static var stat: Font { .system(.title, design: .rounded).weight(.bold).monospacedDigit() }
    /// Small always-visible labels such as the map attribution.
    public static var attribution: Font { .system(.caption2) }
}
#endif
