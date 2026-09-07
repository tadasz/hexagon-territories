#if canImport(SwiftUI)
import SwiftUI

/// One walk in full (spec US4 scenario 2): the path preview and the per-hex metres from the server's summary, or the
/// provisional estimate while the walk is pending upload.
public struct WalkDetailView: View {
    private let row: WalkRow
    private let viewModel: WalkHistoryViewModel
    @State private var summary: WalkSummaryPresentation?
    @State private var loaded = false

    public init(row: WalkRow, viewModel: WalkHistoryViewModel) {
        self.row = row
        self.viewModel = viewModel
    }

    public var body: some View {
        Group {
            if let summary {
                List {
                    Section {
                        MiniPathView(path: summary.path)
                            .frame(height: 180)
                            .listRowInsets(EdgeInsets())
                    }
                    Section {
                        if let banner = summary.flagsBanner {
                            Label(banner, systemImage: "exclamationmark.triangle.fill")
                                .foregroundStyle(.orange)
                        }
                        Text(summary.statusLine)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        LabeledContent("Distance", value: summary.distanceText)
                        LabeledContent("Duration", value: summary.durationText)
                        LabeledContent("XP", value: summary.xpText)
                        LabeledContent("Hexagons", value: "\(summary.hexCount)")
                    }
                    Section(summary.metersColumnTitle) {
                        ForEach(summary.hexes) { hex in
                            HexRowView(hex: hex)
                        }
                    }
                }
            } else if loaded {
                ContentUnavailableView(
                    "Walk not available",
                    systemImage: "questionmark.circle",
                    description: Text(viewModel.errorMessage ?? "This walk could not be loaded.")
                )
                .accessibilityIdentifier("walk.detail.unavailable")
            } else {
                ProgressView()
            }
        }
        .navigationTitle(row.startedAt.formatted(date: .abbreviated, time: .shortened))
        .task {
            summary = await viewModel.detail(for: row)
            loaded = true
        }
    }
}
#endif
