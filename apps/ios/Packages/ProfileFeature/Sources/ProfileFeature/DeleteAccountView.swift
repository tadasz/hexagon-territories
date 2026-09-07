#if canImport(SwiftUI)
import Core
import DesignSystem
import SwiftUI

/// Two-step deletion (spec US5): a sheet explaining the 30-day grace period and what is erased, then a destructive
/// confirmation dialog. After the request the local session is cleared and the app returns to sign-in.
public struct DeleteAccountView: View {
    private let viewModel: ProfileViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var isConfirming = false

    public init(viewModel: ProfileViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                Label("Delete your account", systemImage: "trash")
                    .font(Typography.sectionTitle)
                Text(
                    "Your account is marked for deletion immediately and you are signed out on every device. "
                        + "If you sign in with the same Apple ID within 30 days, everything is restored."
                )
                Text(
                    "After 30 days we permanently erase your profile, faction membership, walk history, captures, "
                        + "exports and sign-in records. Hex ownership already counted for your faction stays with the faction."
                )
                if let errorMessage = viewModel.errorMessage {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                        .accessibilityIdentifier("profile.deleteError")
                }
                Spacer()
                Button(role: .destructive) {
                    isConfirming = true
                } label: {
                    HStack {
                        if viewModel.isDeleting { ProgressView() }
                        Text("Delete my account")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
                .controlSize(.large)
                .disabled(viewModel.isDeleting)
                .accessibilityIdentifier("profile.deleteConfirm")
            }
            .font(Typography.body)
            .padding(24)
            .navigationTitle("Delete account")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .confirmationDialog(
                "Delete your account? You have 30 days to change your mind by signing in again.",
                isPresented: $isConfirming,
                titleVisibility: .visible
            ) {
                Button("Delete account", role: .destructive) {
                    Task {
                        if await viewModel.deleteAccount() { dismiss() }
                    }
                }
                Button("Keep my account", role: .cancel) {}
            }
        }
    }
}
#endif
