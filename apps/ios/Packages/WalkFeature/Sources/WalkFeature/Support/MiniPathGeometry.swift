import Foundation
import H3Kit

/// Fits a path into a small frame for the history row preview (research.md R18 `MiniPathView`): equirectangular
/// projection scaled by cos(mean latitude), aspect ratio preserved, centred, north up. Pure Foundation so it is
/// tested on Linux.
public enum MiniPathGeometry {
    public struct Point: Sendable, Equatable {
        public var x: Double
        public var y: Double

        public init(x: Double, y: Double) {
            self.x = x
            self.y = y
        }
    }

    /// Points in frame coordinates (origin top-left, y down). A single point or a degenerate path maps to the centre.
    public static func normalize(_ path: [LatLng], width: Double, height: Double, padding: Double = 2) -> [Point] {
        guard !path.isEmpty, width > 0, height > 0 else { return [] }
        let meanLat = path.reduce(0.0) { $0 + $1.lat } / Double(path.count)
        let cosLat = max(0.01, cos(meanLat * .pi / 180))
        let projected = path.map { (x: $0.lon * cosLat, y: $0.lat) }
        let minX = projected.map(\.x).min() ?? 0
        let maxX = projected.map(\.x).max() ?? 0
        let minY = projected.map(\.y).min() ?? 0
        let maxY = projected.map(\.y).max() ?? 0
        let spanX = maxX - minX
        let spanY = maxY - minY
        let innerW = max(0, width - 2 * padding)
        let innerH = max(0, height - 2 * padding)
        guard spanX > 0 || spanY > 0 else {
            return projected.map { _ in Point(x: width / 2, y: height / 2) }
        }
        let scale = min(spanX > 0 ? innerW / spanX : .infinity, spanY > 0 ? innerH / spanY : .infinity)
        let drawnW = spanX * scale
        let drawnH = spanY * scale
        let offsetX = padding + (innerW - drawnW) / 2
        let offsetY = padding + (innerH - drawnH) / 2
        return projected.map { point in
            Point(
                x: offsetX + (point.x - minX) * scale,
                y: offsetY + (maxY - point.y) * scale
            )
        }
    }
}
