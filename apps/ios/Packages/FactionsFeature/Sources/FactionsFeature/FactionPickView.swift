#if canImport(SwiftUI)
import Core
import DesignSystem
import SwiftUI

/// The pick screen shown after the first sign-in (spec US2): three cards, the suggested one pre-selected and
/// badged, and a confirm button. Also used for a faction change from the Factions tab.
public struct FactionPickView: View {
    private let viewModel: FactionsViewModel
    private let title: String

    public init(viewModel: FactionsViewModel, title: String = "Choose your faction") {
        self.viewModel = viewModel
        self.title = title
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text(title)
                    .font(Typography.screenTitle)
                Text(
                    "Owls, Foxes and Deer compete for hexagons every week. The faction with the fewest active "
                        + "players is suggested so the map stays balanced. You can change your faction later, but only "
                        + "once every 30 days."
                )
                    .font(Typography.body)
                    .foregroundStyle(.secondary)
                content
            }
            .padding(20)
        }
        .safeAreaInset(edge: .bottom) {
            confirmBar
        }
        .task { await viewModel.load() }
        .accessibilityIdentifier("factions.pick")
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.phase {
        case .loading:
            ProgressView("Loading factions…")
                .frame(maxWidth: .infinity)
                .padding(.vertical, 40)
        case let .failed(message):
            ContentUnavailableView {
                Label("Could not load factions", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Try again") { Task { await viewModel.load() } }
                    .buttonStyle(.borderedProminent)
            }
        case .loaded:
            FactionCardList(viewModel: viewModel, selectable: !viewModel.lock.isLocked || !viewModel.hasFaction)
            if let lockMessage = viewModel.lockMessage {
                Label(lockMessage, systemImage: "lock.fill")
                    .font(Typography.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("factions.lock")
            }
        }
    }

    private var confirmBar: some View {
        VStack(spacing: 8) {
            if let errorMessage = viewModel.errorMessage {
                Text(errorMessage)
                    .font(Typography.caption)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
                    .accessibilityIdentifier("factions.error")
            }
            Button {
                Task { await viewModel.confirm() }
            } label: {
                HStack {
                    if viewModel.isConfirming { ProgressView().tint(.white) }
                    Text(confirmTitle)
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(!viewModel.confirmEnabled)
            .accessibilityIdentifier("factions.confirm")
        }
        .padding(16)
        .background(.bar)
    }

    private var confirmTitle: String {
        if let selected = viewModel.selectedFaction {
            return viewModel.hasFaction ? "Switch to the \(selected.name)" : "Join the \(selected.name)"
        }
        return "Choose a faction"
    }
}

/// The three cards bound to the view model's selection.
struct FactionCardList: View {
    let viewModel: FactionsViewModel
    let selectable: Bool

    var body: some View {
        VStack(spacing: 12) {
            ForEach(viewModel.rows) { row in
                FactionCard(
                    row: row,
                    activeWindowDays: viewModel.activeWindowDays ?? 14,
                    isSelected: row.id == viewModel.selectedFactionId,
                    isSelectable: selectable
                ) {
                    viewModel.select(row.id)
                }
            }
        }
    }
}
#endif
