import DesignSystem
import MapFeature
import SwiftUI

/// Five-tab shell (spec FR-007): Map · Walk · Capture · Collection · Profile. Only the Map tab has real content in
/// 001; the others show `PlaceholderScreen` until their feature lands (Factions joins in feature 002).
struct RootView: View {
    @Environment(AppContainer.self) private var container
    @State private var selectedTab: AppTab = .map

    var body: some View {
        TabView(selection: $selectedTab) {
            ForEach(AppTab.allCases) { tab in
                screen(for: tab)
                    .tabItem { Label(tab.title, systemImage: tab.systemImage) }
                    .tag(tab)
            }
        }
        .accessibilityIdentifier("root.tabs")
    }

    @ViewBuilder
    private func screen(for tab: AppTab) -> some View {
        switch tab {
        case .map:
            MapScreen(config: container.mapConfig)
        case .walk, .capture, .collection, .profile:
            PlaceholderScreen(title: tab.title, systemImage: tab.systemImage)
        }
    }
}

#Preview {
    RootView()
        .environment(AppContainer())
}
