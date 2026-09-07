#if canImport(SwiftUI)
import H3Kit
import SwiftUI

/// A small polyline of the walk drawn with `Canvas` (no map; research.md R18). Empty paths draw a placeholder dot.
public struct MiniPathView: View {
    private let path: [LatLng]

    public init(path: [LatLng]) {
        self.path = path
    }

    public var body: some View {
        Canvas { context, size in
            let points = MiniPathGeometry.normalize(path, width: size.width, height: size.height, padding: 4)
            guard let first = points.first else {
                let dot = CGRect(x: size.width / 2 - 3, y: size.height / 2 - 3, width: 6, height: 6)
                context.fill(Path(ellipseIn: dot), with: .color(.secondary))
                return
            }
            var line = Path()
            line.move(to: CGPoint(x: first.x, y: first.y))
            for point in points.dropFirst() {
                line.addLine(to: CGPoint(x: point.x, y: point.y))
            }
            context.stroke(line, with: .color(.accentColor), style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            if let last = points.last {
                let end = CGRect(x: last.x - 2.5, y: last.y - 2.5, width: 5, height: 5)
                context.fill(Path(ellipseIn: end), with: .color(.accentColor))
            }
        }
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityHidden(true)
    }
}
#endif
