import SwiftUI

/// The Map tab: the basemap plus the always-visible attribution (`docs/architecture.md` §4 Map).
public struct MapScreen: View {
    private let config: MapConfig

    public init(config: MapConfig) {
        self.config = config
    }

    public var body: some View {
        MapLibreView(config: config)
            .ignoresSafeArea(edges: .horizontal)
            .overlay(alignment: .bottomLeading) {
                Text(MapConfig.attribution)
                    .font(.caption2)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(.thinMaterial, in: Capsule())
                    .padding(8)
                    .accessibilityIdentifier("map.attribution")
            }
            .accessibilityIdentifier("map.screen")
    }
}
