import Core
import Foundation
import XCTest

/// The six walk codes of `data-model.md` §2.5 and the transient/permanent split of plan.md Shared Semantics 13.
final class APIErrorWalkCodesTests: XCTestCase {
    func testWalkCodesMap() {
        XCTAssertEqual(APIError(code: "WALK_NOT_FOUND", status: 404), .walkNotFound)
        XCTAssertEqual(APIError(code: "WALK_NOT_ACTIVE", status: 409), .walkNotActive)
        XCTAssertEqual(
            APIError(code: "WALK_OVERLAP", status: 409, details: ["activeWalkId": .string("w-1")]),
            .walkOverlap(activeWalkId: "w-1")
        )
        XCTAssertEqual(APIError(code: "WALK_OVERLAP", status: 409), .walkOverlap(activeWalkId: nil))
        XCTAssertEqual(APIError(code: "FACTION_REQUIRED", status: 403), .factionRequired)
        XCTAssertEqual(APIError(code: "INVALID_ENDED_AT", status: 400), .invalidEndedAt)
        XCTAssertEqual(
            APIError(code: "SAMPLE_QUOTA_EXCEEDED", status: 429, details: ["retryAfterS": .number(3600)]),
            .sampleQuotaExceeded(retryAfterS: 3600)
        )
    }

    func testCodesRoundTrip() {
        let errors: [APIError] = [
            .walkNotFound, .walkNotActive, .walkOverlap(activeWalkId: "x"), .factionRequired, .invalidEndedAt,
            .sampleQuotaExceeded(retryAfterS: 5),
        ]
        for error in errors {
            let code = try! XCTUnwrap(error.code)
            let mapped = APIError(code: code, status: 400, details: ["activeWalkId": .string("x"), "retryAfterS": .number(5)])
            XCTAssertEqual(mapped, error, code)
        }
    }

    func testRetryAfterIsExposed() {
        XCTAssertEqual(APIError.sampleQuotaExceeded(retryAfterS: 30).retryAfterS, 30)
        XCTAssertEqual(APIError.rateLimited(retryAfterS: 7).retryAfterS, 7)
        XCTAssertNil(APIError.walkNotActive.retryAfterS)
    }

    func testTransientVersusPermanent() {
        let transient: [APIError] = [
            .network(underlying: URLError(.notConnectedToInternet)),
            .rateLimited(retryAfterS: 1),
            .sampleQuotaExceeded(retryAfterS: nil),
            .unexpected(code: "HTTP_503", status: 503),
            .unexpected(code: "HTTP_408", status: 408),
            .unexpected(code: "DB_UNAVAILABLE", status: 503),
            .unauthorized,
            .tokenExpired,
        ]
        XCTAssertTrue(transient.allSatisfy(\.isTransient), "\(transient.filter { !$0.isTransient })")
        let permanent: [APIError] = [
            .walkNotFound, .walkNotActive, .walkOverlap(activeWalkId: nil), .factionRequired, .invalidEndedAt,
            .validation(message: "samples"), .unexpected(code: "HTTP_404", status: 404), .factionNotFound,
        ]
        XCTAssertFalse(permanent.contains(where: \.isTransient), "\(permanent.filter(\.isTransient))")
    }

    func testUserMessagesArePlayerFacing() {
        XCTAssertTrue(APIError.factionRequired.userMessage.lowercased().contains("faction"))
        XCTAssertTrue(APIError.walkOverlap(activeWalkId: nil).userMessage.lowercased().contains("walk"))
        XCTAssertFalse(APIError.walkNotFound.userMessage.contains("WALK_NOT_FOUND"))
    }
}
