#if canImport(SwiftUI)
import Location
import SwiftUI

/// The live numbers (spec FR-003): moving time, distance, current hex, "≈ N m in this hex (estimate)", hex count,
/// the paused badge and the waiting-for-GPS state. Every number is provisional until the server's summary.
public struct WalkHUDView: View {
    private let hud: HUDState
    private let storeWarning: Bool

    public init(hud: HUDState, storeWarning: Bool = false) {
        self.hud = hud
        self.storeWarning = storeWarning
    }

    public var body: some View {
        VStack(spacing: 16) {
            if hud.isPaused {
                Label("Paused — move to resume", systemImage: "pause.circle.fill")
                    .font(.headline)
                    .foregroundStyle(.orange)
                    .accessibilityIdentifier("walk.paused")
            }
            HStack(spacing: 32) {
                metric(title: "Moving time", value: hud.movingTimeText, identifier: "walk.hud.time")
                metric(title: "Distance", value: hud.distanceText, identifier: "walk.hud.distance")
            }
            if hud.waitingForGPS {
                Label("Waiting for GPS…", systemImage: "location.circle")
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("walk.hud.waitingForGPS")
            } else {
                VStack(spacing: 4) {
                    Text(hud.currentCellShortId.map { "Hex \($0)" } ?? "Hex —")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Text(hud.currentCellText)
                        .font(.title3.weight(.semibold))
                        .accessibilityIdentifier("walk.hud.currentCell")
                }
            }
            metric(title: "Hexagons visited", value: "\(hud.hexCount)", identifier: "walk.hud.hexCount")
            Text("Estimates only — the server scores the walk when you stop.")
                .font(.footnote)
                .foregroundStyle(.secondary)
            if storeWarning {
                Label("This walk may not be saved on this device.", systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }
        }
        .padding(.top, 24)
    }

    private func metric(title: String, value: String, identifier: String) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.system(.largeTitle, design: .rounded).monospacedDigit().weight(.bold))
                .accessibilityIdentifier(identifier)
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}
#endif
