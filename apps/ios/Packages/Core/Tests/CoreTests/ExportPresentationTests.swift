import Core
import CoreTestSupport
import Foundation
import XCTest

final class ExportPresentationTests: XCTestCase {
    private let now = Fixtures.now

    func testStartedIsPending() {
        XCTAssertEqual(ExportPresentation.idle.started(at: now), .pending(since: now))
        XCTAssertEqual(ExportPresentation.timedOut.started(at: now), .pending(since: now))
        XCTAssertTrue(ExportPresentation.pending(since: now).isPolling)
        XCTAssertFalse(ExportPresentation.idle.isPolling)
    }

    func testPendingStaysPendingWithinBudget() {
        let state = ExportPresentation.pending(since: now)
        let later = now.addingTimeInterval(ExportPresentation.pollBudget - 1)
        XCTAssertEqual(state.receiving(Fixtures.exportStatus(.pending), at: later), .pending(since: now))
    }

    func testPendingTimesOutAfterFiveMinutes() {
        XCTAssertEqual(ExportPresentation.pollBudget, 300)
        XCTAssertEqual(ExportPresentation.maxPolls, 60)
        let state = ExportPresentation.pending(since: now)
        let deadline = now.addingTimeInterval(ExportPresentation.pollBudget)
        let timedOut = state.receiving(Fixtures.exportStatus(.pending), at: deadline)
        XCTAssertEqual(timedOut, .timedOut)
        XCTAssertFalse(timedOut.isPolling)
    }

    func testPendingFromIdleStartsTheClock() {
        XCTAssertEqual(ExportPresentation.idle.receiving(Fixtures.exportStatus(.pending), at: now), .pending(since: now))
    }

    func testReadyCarriesUrlAndExpiry() throws {
        let status = Fixtures.exportStatus(.ready)
        let state = ExportPresentation.pending(since: now).receiving(status, at: now.addingTimeInterval(10))
        XCTAssertEqual(state, .ready(url: try XCTUnwrap(status.downloadURL), expiresAt: status.expiresAt))
        XCTAssertFalse(state.isPolling)
    }

    func testReadyWithoutUrlFails() {
        var status = Fixtures.exportStatus(.ready)
        status.downloadUrl = nil
        guard case .failed = ExportPresentation.pending(since: now).receiving(status, at: now) else {
            return XCTFail("expected failed")
        }
    }

    func testFailedStatusUsesServerText() {
        let status = Fixtures.exportStatus(.failed, error: "bucket unavailable")
        XCTAssertEqual(ExportPresentation.pending(since: now).receiving(status, at: now), .failed(message: "bucket unavailable"))
        let bare = Fixtures.exportStatus(.failed)
        guard case let .failed(message) = ExportPresentation.pending(since: now).receiving(bare, at: now) else {
            return XCTFail("expected failed")
        }
        XCTAssertFalse(message.isEmpty)
    }

    func testFailingMapsErrors() {
        XCTAssertEqual(
            ExportPresentation.pending(since: now).failing(APIError.rateLimited(retryAfterS: 9)),
            .failed(message: APIError.rateLimited(retryAfterS: 9).userMessage)
        )
        XCTAssertEqual(
            ExportPresentation.pending(since: now).failing(OfflineError()),
            .failed(message: Fixtures.offline.userMessage)
        )
    }
}
