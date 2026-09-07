#if canImport(SwiftUI)
import DesignSystem
import SwiftUI

/// The finish summary (spec US2 scenario 1, US3 scenario 2): distance, duration, XP, the flags banner, and per-hex
/// rows with metres / counted metres / this week's leader and the player's faction share. The "pending upload"
/// variant labels every number as an estimate.
public struct FinishSummarySheet: View {
    private let summary: WalkSummaryPresentation
    private let notice: String?
    private let pendingUploads: Int

    public init(summary: WalkSummaryPresentation, notice: String? = nil, pendingUploads: Int = 0) {
        self.summary = summary
        self.notice = notice
        self.pendingUploads = pendingUploads
    }

    public var body: some View {
        NavigationStack {
            List {
                Section {
                    if let notice {
                        Label(notice, systemImage: "info.circle")
                            .font(.footnote)
                    }
                    if let banner = summary.flagsBanner {
                        Label(banner, systemImage: "exclamationmark.triangle.fill")
                            .foregroundStyle(.orange)
                            .accessibilityIdentifier("walk.summary.flagged")
                    }
                    Text(summary.statusLine)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("walk.summary.status")
                }
                Section {
                    LabeledContent("Distance", value: summary.distanceText)
                    LabeledContent("Duration", value: summary.durationText)
                    LabeledContent("XP", value: summary.xpText)
                        .accessibilityIdentifier("walk.summary.xp")
                    LabeledContent("Hexagons", value: "\(summary.hexCount)")
                }
                Section(summary.metersColumnTitle) {
                    ForEach(summary.hexes) { hex in
                        HexRowView(hex: hex)
                    }
                }
            }
            .navigationTitle(summary.isProvisional ? "Walk saved" : "Walk scored")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

struct HexRowView: View {
    let hex: WalkSummaryPresentation.HexRow

    var body: some View {
        HStack {
            VStack(alignment: .leading) {
                Text("Hex \(hex.shortId)")
                    .font(.body.monospaced())
                if let share = hex.shareText {
                    Text(share)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            VStack(alignment: .trailing) {
                Text(hex.metersText)
                    .font(.body.monospacedDigit())
                if let counted = hex.countedText {
                    Text(counted)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            if let leader = hex.leaderFactionId {
                Text(Faction(rawValue: leader)?.emoji ?? "🏳️")
                    .accessibilityLabel("Leading faction \(Faction(rawValue: leader)?.name ?? "\(leader)")")
            }
        }
    }
}
#endif
