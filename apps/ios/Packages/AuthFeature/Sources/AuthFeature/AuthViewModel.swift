import Core
import Foundation
import Observation

/// Drives `SignInView` (research.md R13): maps the Sign in with Apple outcome to `AuthSession.signIn`, shows a retry
/// banner on failure and stays silent on cancellation.
@Observable
@MainActor
public final class AuthViewModel {
    public enum Phase: Equatable, Sendable {
        case idle
        case signingIn
        case failed(message: String)
    }

    /// What the Sign in with Apple button produced, in platform-neutral terms (built from
    /// `ASAuthorizationAppleIDCredential` in `AppleCredentialMapping.swift`).
    public enum AppleOutcome: Equatable, Sendable {
        case payload(AppleSignInPayload)
        case cancelled
        case failed(message: String)

        public static let missingTokenMessage = "Apple did not return an identity token. Please try again."
        public static let genericFailureMessage = "Sign in with Apple did not complete. Please try again."

        /// Builds the sign-in payload from the raw credential parts.
        public static func from(
            identityToken: Data?,
            authorizationCode: Data?,
            fullName: PersonNameComponents?
        ) -> AppleOutcome {
            guard let identityToken, let token = String(data: identityToken, encoding: .utf8), !token.isEmpty else {
                return .failed(message: missingTokenMessage)
            }
            let code = authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
            let name = fullName.map { PersonName(givenName: $0.givenName, familyName: $0.familyName) }
            return .payload(AppleSignInPayload(identityToken: token, authorizationCode: code, fullName: name))
        }
    }

    public private(set) var phase: Phase = .idle

    private let session: AuthSession
    private let onSignedIn: @MainActor @Sendable (AuthResult) -> Void

    public init(session: AuthSession, onSignedIn: @escaping @MainActor @Sendable (AuthResult) -> Void = { _ in }) {
        self.session = session
        self.onSignedIn = onSignedIn
    }

    public var isSigningIn: Bool { phase == .signingIn }

    public var errorMessage: String? {
        if case let .failed(message) = phase { return message }
        return nil
    }

    public func handle(_ outcome: AppleOutcome) async {
        switch outcome {
        case let .payload(payload):
            await signIn(with: payload)
        case .cancelled:
            phase = .idle
        case let .failed(message):
            phase = .failed(message: message)
        }
    }

    public func signIn(with payload: AppleSignInPayload) async {
        guard !isSigningIn else { return }
        phase = .signingIn
        do {
            let result = try await session.signIn(payload)
            phase = .idle
            onSignedIn(result)
        } catch let error as APIError {
            phase = .failed(message: error.userMessage)
        } catch {
            phase = .failed(message: APIError.network(underlying: error).userMessage)
        }
    }

    public func dismissError() {
        if case .failed = phase { phase = .idle }
    }
}
