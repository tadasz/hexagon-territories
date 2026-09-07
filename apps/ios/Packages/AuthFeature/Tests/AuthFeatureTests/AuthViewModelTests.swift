import AuthFeature
import Core
import CoreTestSupport
import Foundation
import XCTest

@MainActor
final class AuthViewModelTests: XCTestCase {
    private var service: FakeAuthService!
    private var store: RecordingTokenStore!
    private var session: AuthSession!

    override func setUp() async throws {
        service = FakeAuthService()
        store = RecordingTokenStore()
        session = AuthSession(service: service, store: store, clock: FakeClock())
    }

    func testSuccessfulSignInSignsTheSessionIn() async {
        let received = Locked<AuthResult?>(nil)
        let viewModel = AuthViewModel(session: session) { received.value = $0 }

        await viewModel.handle(.payload(Fixtures.applePayload))

        XCTAssertEqual(viewModel.phase, .idle)
        XCTAssertEqual(service.signInCalls, [Fixtures.applePayload])
        XCTAssertEqual(store.pair, Fixtures.tokenPair())
        XCTAssertEqual(received.value?.isNewUser, true)
        let state = await session.state
        XCTAssertEqual(state, .signedIn(Fixtures.tokenPair()))
    }

    func testAppleUnavailableShowsRetryMessage() async {
        service.signInResult = .failure(APIError.appleUnavailable)
        let viewModel = AuthViewModel(session: session)

        await viewModel.handle(.payload(Fixtures.applePayload))

        XCTAssertEqual(viewModel.phase, .failed(message: APIError.appleUnavailable.userMessage))
        XCTAssertEqual(viewModel.errorMessage, APIError.appleUnavailable.userMessage)
        let state = await session.state
        XCTAssertEqual(state, .signedOut)
        viewModel.dismissError()
        XCTAssertEqual(viewModel.phase, .idle)
    }

    func testNetworkFailureShowsConnectionMessage() async {
        service.signInResult = .failure(OfflineError())
        let viewModel = AuthViewModel(session: session)
        await viewModel.handle(.payload(Fixtures.applePayload))
        XCTAssertEqual(viewModel.errorMessage, Fixtures.offline.userMessage)
    }

    func testCancellationIsSilent() async {
        let viewModel = AuthViewModel(session: session)
        await viewModel.handle(.cancelled)
        XCTAssertEqual(viewModel.phase, .idle)
        XCTAssertTrue(service.signInCalls.isEmpty)
    }

    func testAppleFailureMessageIsShown() async {
        let viewModel = AuthViewModel(session: session)
        await viewModel.handle(.failed(message: "nope"))
        XCTAssertEqual(viewModel.errorMessage, "nope")
    }

    func testOutcomeMappingFromCredentialParts() {
        var components = PersonNameComponents()
        components.givenName = "Tadas"
        let outcome = AuthViewModel.AppleOutcome.from(
            identityToken: Data("apple-identity-jwt".utf8),
            authorizationCode: Data("apple-code".utf8),
            fullName: components
        )
        XCTAssertEqual(outcome, .payload(Fixtures.applePayload))

        XCTAssertEqual(
            AuthViewModel.AppleOutcome.from(identityToken: nil, authorizationCode: nil, fullName: nil),
            .failed(message: AuthViewModel.AppleOutcome.missingTokenMessage)
        )
        let bare = AuthViewModel.AppleOutcome.from(
            identityToken: Data("jwt".utf8), authorizationCode: nil, fullName: PersonNameComponents()
        )
        XCTAssertEqual(bare, .payload(AppleSignInPayload(identityToken: "jwt")), "empty name components are dropped")
    }
}
