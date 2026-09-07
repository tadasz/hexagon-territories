#if canImport(SwiftUI)
import Core
import DesignSystem
import SwiftUI

/// The Factions tab (spec US4): the player's faction, the live cards, the lock notice from
/// `Me.factionChangeAvailableAt`, and "Change faction" (disabled while locked) that opens `FactionPickView`.
public struct FactionsScreen: View {
    private let viewModel: FactionsViewModel
    @State private var isChanging = false

    public init(viewModel: FactionsViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
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
                        }
                    case .loaded:
                        FactionCardList(viewModel: viewModel, selectable: false)
                        changeSection
                    }
                }
                .padding(20)
            }
            .navigationTitle("Factions")
            .refreshable { await viewModel.load() }
            .task { await viewModel.load() }
            .sheet(isPresented: $isChanging) {
                FactionPickView(viewModel: viewModel, title: "Change your faction")
                    .onChange(of: viewModel.me?.factionId) { _, _ in isChanging = false }
            }
        }
        .accessibilityIdentifier("factions.screen")
    }

    @ViewBuilder
    private var header: some View {
        if let faction = viewModel.currentFaction {
            HStack(spacing: 12) {
                Text(faction.emoji).font(.system(size: 36))
                VStack(alignment: .leading) {
                    Text("Your faction").font(Typography.caption).foregroundStyle(.secondary)
                    Text(faction.name).font(Typography.sectionTitle)
                }
            }
            .accessibilityIdentifier("factions.current")
        } else if viewModel.phase == .loaded {
            Text("You have not joined a faction yet.")
                .font(Typography.body)
                .foregroundStyle(.secondary)
        }
    }

    private var changeSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let lockMessage = viewModel.lockMessage {
                Label(lockMessage, systemImage: "lock.fill")
                    .font(Typography.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("factions.lock")
            } else if viewModel.hasFaction {
                Text("Switching factions keeps your XP and level. The next change will be possible 30 days later.")
                    .font(Typography.caption)
                    .foregroundStyle(.secondary)
            }
            Button(viewModel.hasFaction ? "Change faction" : "Choose a faction") {
                isChanging = true
            }
            .buttonStyle(.bordered)
            .disabled(viewModel.lock.isLocked)
            .accessibilityIdentifier("factions.change")
        }
        .padding(.top, 8)
    }
}
#endif
