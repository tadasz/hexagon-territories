import Core
import Foundation
import XCTest

/// `data-model.md` §2.6 codes → `APIError` cases; unknown codes → `.unexpected` (plan.md Shared Semantics 12).
final class APIErrorMappingTests: XCTestCase {
    func testKnownCodesMap() {
        XCTAssertEqual(APIError(code: "UNAUTHORIZED", status: 401), .unauthorized)
        XCTAssertEqual(APIError(code: "TOKEN_EXPIRED", status: 401), .tokenExpired)
        XCTAssertEqual(APIError(code: "ACCOUNT_DELETED", status: 401), .accountDeleted)
        XCTAssertEqual(APIError(code: "APPLE_UNAVAILABLE", status: 503), .appleUnavailable)
        XCTAssertEqual(APIError(code: "INVALID_REFRESH_TOKEN", status: 401), .invalidRefreshToken)
        XCTAssertEqual(APIError(code: "REFRESH_REUSED", status: 401), .refreshReused)
        XCTAssertEqual(APIError(code: "FACTION_NOT_FOUND", status: 404), .factionNotFound)
        XCTAssertEqual(APIError(code: "VALIDATION_FAILED", status: 400, message: "bad"), .validation(message: "bad"))
    }

    func testDetailsAreExtracted() {
        XCTAssertEqual(
            APIError(code: "INVALID_APPLE_TOKEN", status: 401, details: ["reason": .string("audience")]),
            .invalidAppleToken(reason: "audience")
        )
        XCTAssertEqual(APIError(code: "INVALID_APPLE_TOKEN", status: 401), .invalidAppleToken(reason: nil))
        XCTAssertEqual(
            APIError(code: "RATE_LIMITED", status: 429, details: ["retryAfterS": .number(42)]),
            .rateLimited(retryAfterS: 42)
        )
        XCTAssertEqual(APIError(code: "RATE_LIMITED", status: 429), .rateLimited(retryAfterS: nil))
        let nextChangeAt = "2026-10-07T10:00:00.000Z"
        XCTAssertEqual(
            APIError(code: "FACTION_CHANGE_LOCKED", status: 409, details: ["nextChangeAt": .string(nextChangeAt)]),
            .factionChangeLocked(nextChangeAt: JSONCoding.parseISO8601(nextChangeAt)!)
        )
    }

    func testLockWithoutDateIsUnexpected() {
        XCTAssertEqual(
            APIError(code: "FACTION_CHANGE_LOCKED", status: 409),
            .unexpected(code: "FACTION_CHANGE_LOCKED", status: 409)
        )
    }

    func testUnknownCodeIsUnexpected() {
        XCTAssertEqual(APIError(code: "SOMETHING_NEW", status: 418), .unexpected(code: "SOMETHING_NEW", status: 418))
        XCTAssertEqual(APIError(code: "FORBIDDEN", status: 403).code, "FORBIDDEN")
    }

    func testEnvelopeInit() {
        let envelope = ErrorEnvelope(
            error: .init(code: "RATE_LIMITED", message: "slow down", details: ["retryAfterS": .number(7)]),
            requestId: "r1"
        )
        XCTAssertEqual(APIError(envelope: envelope, status: 429), .rateLimited(retryAfterS: 7))
    }

    func testSessionEndingCodes() {
        let ending: [APIError] = [.unauthorized, .tokenExpired, .accountDeleted, .invalidRefreshToken, .refreshReused]
        XCTAssertTrue(ending.allSatisfy(\.endsSession))
        let keeping: [APIError] = [
            .appleUnavailable, .rateLimited(retryAfterS: 1), .validation(message: ""), .network(underlying: URLError(.timedOut)),
            .unexpected(code: "INTERNAL_ERROR", status: 500), .factionNotFound,
        ]
        XCTAssertFalse(keeping.contains(where: \.endsSession))
    }

    func testUserMessagesNeverEchoTheServerMessage() {
        let error = APIError(code: "VALIDATION_FAILED", status: 400, message: "body/displayName must be string")
        XCTAssertFalse(error.userMessage.contains("body/displayName"))
        XCTAssertTrue(APIError.rateLimited(retryAfterS: 30).userMessage.contains("30"))
    }
}
