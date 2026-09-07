#if canImport(SwiftUI)
import Core
import DesignSystem
import Location
import SwiftUI

/// The Walk tab (spec US1): Start/Stop, the live HUD, the paused badge, "waiting for GPS", the offline/pending
/// banner, the permission prompt, and the finish sheet. `history` builds the history destination.
public struct WalkScreen<History: View>: View {
    private let viewModel: WalkViewModel
    private let history: () -> History

    public init(viewModel: WalkViewModel, @ViewBuilder history: @escaping () -> History) {
        self.viewModel = viewModel
        self.history = history
    }

    public var body: some View {
        VStack(spacing: 24) {
            content
            Spacer()
            controls
        }
        .padding()
        .navigationTitle("Walk")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink("History") { history() }
                    .accessibilityIdentifier("walk.history")
            }
        }
        .sheet(isPresented: summaryPresented) {
            if let summary = viewModel.summary {
                FinishSummarySheet(summary: summary, notice: viewModel.notice, pendingUploads: viewModel.pendingUploads)
            }
        }
        .task { await viewModel.recoverIfNeeded() }
    }

    private var summaryPresented: Binding<Bool> {
        Binding(
            get: { viewModel.phase == .summary && viewModel.summary != nil },
            set: { presented in if !presented { viewModel.dismissSummary() } }
        )
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.phase {
        case .idle, .summary, .checkingPermission, .finishing:
            idleContent
        case let .permissionDenied(status):
            PermissionView(status: status)
        case .needsFaction:
            ContentUnavailableView(
                "Pick a faction first",
                systemImage: "flag.2.crossed",
                description: Text("Your metres are credited to your faction. Choose one on the Factions tab.")
            )
            .accessibilityIdentifier("walk.needsFaction")
        case .recording, .paused:
            WalkHUDView(hud: viewModel.hud, storeWarning: viewModel.storeWarning)
        case let .failed(message):
            ContentUnavailableView("Could not start", systemImage: "location.slash", description: Text(message))
        }
    }

    private var idleContent: some View {
        VStack(spacing: 12) {
            Image(systemName: "figure.walk")
                .font(.system(size: 56))
                .foregroundStyle(.secondary)
            Text("Start a walk to earn metres for your faction in every hexagon you cross.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            if viewModel.pendingUploads > 0 {
                Label("\(viewModel.pendingUploads) upload(s) waiting for a connection", systemImage: "icloud.slash")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            if viewModel.storeWarning {
                Label("Walks may not be saved on this device (storage unavailable).", systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.orange)
            }
        }
        .padding(.top, 40)
    }

    @ViewBuilder
    private var controls: some View {
        if viewModel.isRecording {
            Button {
                Task { await viewModel.stop() }
            } label: {
                Label("Stop", systemImage: "stop.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.red)
            .controlSize(.large)
            .accessibilityIdentifier("walk.stop")
        } else {
            Button {
                Task { await viewModel.start() }
            } label: {
                Label(startTitle, systemImage: "play.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!viewModel.canStart)
            .accessibilityIdentifier("walk.start")
        }
    }

    private var startTitle: String {
        switch viewModel.phase {
        case .checkingPermission: "Checking location access…"
        case .finishing: "Finishing…"
        default: "Start walk"
        }
    }
}
#endif
