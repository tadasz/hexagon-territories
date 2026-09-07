#if canImport(SwiftUI)
import SwiftUI

/// One history row: date, distance, duration, hexagons, XP, status line, mini path (local walks).
public struct WalkHistoryRow: View {
    private let row: WalkRow

    public init(row: WalkRow) {
        self.row = row
    }

    public var body: some View {
        HStack(spacing: 12) {
            MiniPathView(path: row.path)
                .frame(width: 56, height: 56)
            VStack(alignment: .leading, spacing: 4) {
                Text(row.startedAt, format: .dateTime.day().month().hour().minute())
                    .font(.headline)
                Text("\(row.distanceText) · \(row.durationText) · \(row.hexCount) hex · \(row.xpText)")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(row.statusLine)
                    .font(.caption)
                    .foregroundStyle(statusColor)
            }
        }
        .accessibilityIdentifier("walk.history.row.\(row.id)")
    }

    private var statusColor: Color {
        switch row.status {
        case .flagged, .uploadFailed: .orange
        case .pendingUpload, .recording: .blue
        default: .secondary
        }
    }
}
#endif
