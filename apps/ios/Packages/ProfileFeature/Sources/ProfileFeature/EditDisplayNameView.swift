#if canImport(SwiftUI)
import Core
import DesignSystem
import SwiftUI

/// Display-name form (spec US3): inline rule message and a 24-character counter, save disabled while invalid.
public struct EditDisplayNameView: View {
    @Bindable private var viewModel: ProfileViewModel
    @Environment(\.dismiss) private var dismiss

    public init(viewModel: ProfileViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Display name", text: $viewModel.displayNameDraft)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .submitLabel(.done)
                        .onSubmit { save() }
                        .accessibilityIdentifier("profile.nameField")
                } header: {
                    Text("Display name")
                } footer: {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(viewModel.draftError?.message ?? "Shown to other players on the map and in rankings.")
                                .foregroundStyle(viewModel.draftError == nil ? .secondary : .red)
                                .accessibilityIdentifier("profile.nameRule")
                            Spacer()
                            Text("\(viewModel.draftScalarCount)/\(DisplayNameValidator.maxScalars)")
                                .monospacedDigit()
                                .foregroundStyle(viewModel.draftError == .tooLong ? .red : .secondary)
                                .accessibilityIdentifier("profile.nameCounter")
                        }
                        if let errorMessage = viewModel.errorMessage {
                            Text(errorMessage).foregroundStyle(.red)
                        }
                    }
                }
            }
            .navigationTitle("Edit name")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }
                        .disabled(!viewModel.canSaveDraft)
                        .accessibilityIdentifier("profile.nameSave")
                }
            }
        }
    }

    private func save() {
        Task {
            if await viewModel.saveDisplayName() {
                dismiss()
            }
        }
    }
}
#endif
