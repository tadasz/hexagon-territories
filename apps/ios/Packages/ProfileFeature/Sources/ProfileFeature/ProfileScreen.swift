#if canImport(SwiftUI)
import Core
import DesignSystem
import SwiftUI

/// The Profile tab (spec US3/US5/US6): name, faction, XP, level, member since; Edit name · Sign out · Export my
/// data · Delete account.
public struct ProfileScreen: View {
    private let viewModel: ProfileViewModel
    @State private var isEditingName = false
    @State private var isDeleting = false

    public init(viewModel: ProfileViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        NavigationStack {
            List {
                switch viewModel.phase {
                case .loading:
                    ProgressView("Loading your profile…")
                case let .failed(message):
                    ContentUnavailableView {
                        Label("Could not load your profile", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(message)
                    } actions: {
                        Button("Try again") { Task { await viewModel.load() } }
                    }
                    signOutSection
                case .loaded:
                    if let me = viewModel.me {
                        profileSection(me)
                    }
                    signOutSection
                    dataSection
                }
            }
            .navigationTitle("Profile")
            .refreshable { await viewModel.load() }
            .task { await viewModel.load() }
            .sheet(isPresented: $isEditingName) {
                EditDisplayNameView(viewModel: viewModel)
            }
            .sheet(isPresented: $isDeleting) {
                DeleteAccountView(viewModel: viewModel)
            }
        }
        .accessibilityIdentifier("profile.screen")
    }

    private func profileSection(_ me: Me) -> some View {
        Section {
            HStack(spacing: 16) {
                Text(viewModel.currentFaction?.emoji ?? "🧭")
                    .font(.system(size: 40))
                VStack(alignment: .leading, spacing: 4) {
                    Text(me.displayName)
                        .font(Typography.sectionTitle)
                        .accessibilityIdentifier("profile.name")
                    Text(viewModel.currentFaction?.name ?? "No faction yet")
                        .font(Typography.body)
                        .foregroundStyle(.secondary)
                }
            }
            LabeledContent("Level", value: "\(me.level)")
            LabeledContent("XP", value: "\(me.xp)")
            LabeledContent("Member since", value: me.createdAt.formatted(date: .abbreviated, time: .omitted))
            Button("Edit name") {
                viewModel.beginEditingName()
                isEditingName = true
            }
            .accessibilityIdentifier("profile.editName")
        } header: {
            Text("Explorer")
        } footer: {
            if let errorMessage = viewModel.errorMessage {
                Text(errorMessage).foregroundStyle(.red)
            }
        }
    }

    private var signOutSection: some View {
        Section {
            Button {
                Task { await viewModel.signOut() }
            } label: {
                HStack {
                    Text("Sign out")
                    if viewModel.isSigningOut { Spacer(); ProgressView() }
                }
            }
            .disabled(viewModel.isSigningOut)
            .accessibilityIdentifier("profile.signOut")
        }
    }

    private var dataSection: some View {
        Section {
            NavigationLink("Export my data") {
                ExportView(viewModel: viewModel)
            }
            .accessibilityIdentifier("profile.export")
            Button("Delete account", role: .destructive) {
                isDeleting = true
            }
            .accessibilityIdentifier("profile.delete")
        } header: {
            Text("Your data")
        } footer: {
            Text(
                "Your walk paths are private and never shown to other players. Export gives you everything we "
                    + "store; deleting erases it after a 30-day grace period."
            )
        }
    }
}
#endif
