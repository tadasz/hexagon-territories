#if canImport(SwiftUI) && canImport(AuthenticationServices)
import AuthenticationServices
import Core
import DesignSystem
import SwiftUI

/// The sign-in screen (spec US1, research.md R13): Apple's button requesting `.fullName` and `.email` (only
/// delivered on the first authorization), an error banner with retry, and a short pitch — no attribution is
/// needed here (the map carries its own).
public struct SignInView: View {
    private let viewModel: AuthViewModel
    @Environment(\.colorScheme) private var colorScheme

    public init(viewModel: AuthViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        VStack(spacing: 24) {
            Spacer()
            VStack(spacing: 8) {
                Text("🦉 🦊 🦌")
                    .font(.system(size: 44))
                Text("Nature Explorer")
                    .font(Typography.screenTitle)
                Text("Walk to conquer hexagons for your faction. Capture birds by sound and plants by photo.")
                    .font(Typography.body)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if let message = viewModel.errorMessage {
                errorBanner(message)
            }
            SignInWithAppleButton(.signIn) { request in
                request.requestedScopes = [.fullName, .email]
            } onCompletion: { result in
                let outcome = AuthViewModel.AppleOutcome(result)
                Task { await viewModel.handle(outcome) }
            }
            .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
            .frame(height: 50)
            .disabled(viewModel.isSigningIn)
            .overlay {
                if viewModel.isSigningIn {
                    ProgressView().tint(colorScheme == .dark ? .black : .white)
                }
            }
            .accessibilityIdentifier("signin.apple")
            Text(
                "Your Apple ID only identifies your explorer account. Your name and e-mail are read once, "
                    + "at the first sign-in, and never shown to other players."
            )
                .font(Typography.caption)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
        }
        .padding(24)
        .accessibilityIdentifier("signin.screen")
    }

    private func errorBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
            Text(message)
                .font(Typography.body)
            Spacer(minLength: 0)
            Button("Dismiss") { viewModel.dismissError() }
                .font(Typography.caption)
        }
        .padding(12)
        .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityIdentifier("signin.error")
    }
}
#endif
