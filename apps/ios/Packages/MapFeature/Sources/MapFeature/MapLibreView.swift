@preconcurrency import MapLibre
import os
import SwiftUI

/// `UIViewRepresentable` around `MLNMapView` (ADR 0003: our own wrapper, not the pre-1.0 MapLibre SwiftUI DSL).
/// 001 only shows the basemap; `HexOverlayController` and `WalkPathsLayer` arrive with features 003/005.
public struct MapLibreView: UIViewRepresentable {
    private let config: MapConfig

    public init(config: MapConfig) {
        self.config = config
    }

    public func makeUIView(context: Context) -> MLNMapView {
        let mapView = MLNMapView(frame: .zero, styleURL: config.styleURL)
        mapView.delegate = context.coordinator
        mapView.setCenter(config.initialCenter, zoomLevel: config.initialZoom, animated: false)
        mapView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        // The style's own attribution (OpenStreetMap, OpenFreeMap) is reachable from the ⓘ button; the always-visible
        // text label is drawn by `MapScreen`.
        mapView.attributionButton.isHidden = false
        mapView.logoView.isHidden = true
        mapView.compassView.isHidden = false
        mapView.accessibilityIdentifier = "map.mapView"
        return mapView
    }

    public func updateUIView(_ mapView: MLNMapView, context: Context) {
        if mapView.styleURL != config.styleURL {
            mapView.styleURL = config.styleURL
        }
    }

    public func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    /// Delegate sink. MapLibre calls back on the main thread, but the ObjC protocol is not actor-annotated, so the
    /// methods stay `nonisolated` and only log for now.
    public final class Coordinator: NSObject, MLNMapViewDelegate {
        private static let logger = Logger(subsystem: "com.natureexplorer.app", category: "map")

        public func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
            Self.logger.debug("style loaded: \(style.name ?? "unnamed", privacy: .public)")
        }

        public func mapViewDidFailLoadingMap(_ mapView: MLNMapView, withError error: Error) {
            Self.logger.error("map failed to load: \(error.localizedDescription, privacy: .public)")
        }
    }
}
