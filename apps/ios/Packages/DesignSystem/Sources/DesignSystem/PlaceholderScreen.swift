#if canImport(SwiftUI)
import SwiftUI

/// Placeholder for tabs whose feature has not landed yet (Walk, Capture, Collection, Profile in 001).
public struct PlaceholderScreen: View {
    private let title: String
    private let systemImage: String
    private let message: String

    public init(title: String, systemImage: String, message: String = "Coming in a later feature.") {
        self.title = title
        self.systemImage = systemImage
        self.message = message
    }

    public var body: some View {
        ContentUnavailableView(title, systemImage: systemImage, description: Text(message))
            .accessibilityIdentifier("placeholder.\(title.lowercased())")
    }
}

#Preview {
    PlaceholderScreen(title: "Walk", systemImage: "figure.walk")
}
#endif
