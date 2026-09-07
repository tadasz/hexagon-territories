#if canImport(AuthenticationServices)
import AuthenticationServices
import Core
import Foundation

public extension AuthViewModel.AppleOutcome {
    /// Maps the `SignInWithAppleButton` completion (research.md R13): `identityToken` and `authorizationCode` as
    /// UTF-8 strings, `fullName` only when Apple supplied it (first authorization); `.canceled` is silent.
    init(_ result: Result<ASAuthorization, any Error>) {
        switch result {
        case let .success(authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else {
                self = .failed(message: Self.genericFailureMessage)
                return
            }
            self = .from(
                identityToken: credential.identityToken,
                authorizationCode: credential.authorizationCode,
                fullName: credential.fullName
            )
        case let .failure(error):
            if let authError = error as? ASAuthorizationError, authError.code == .canceled {
                self = .cancelled
            } else {
                self = .failed(message: Self.genericFailureMessage)
            }
        }
    }
}
#endif
