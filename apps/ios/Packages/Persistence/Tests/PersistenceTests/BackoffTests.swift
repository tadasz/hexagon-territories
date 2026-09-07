import Foundation
@testable import Persistence
import XCTest

final class BackoffTests: XCTestCase {
    func testBaseScheduleDoublesUpToFiveMinutes() {
        XCTAssertEqual((1...10).map { Backoff.baseDelay(attempt: $0) }, [2, 4, 8, 16, 32, 64, 128, 256, 300, 300])
        XCTAssertEqual(Backoff.baseDelay(attempt: 0), 1)
        XCTAssertEqual(Backoff.baseDelay(attempt: 1000), 300)
    }

    func testJitterStaysWithinTwentyPercentAndIsSeeded() {
        var backoff = Backoff(seed: 42)
        var same = Backoff(seed: 42)
        var other = Backoff(seed: 7)
        var sawDifferent = false
        for attempt in 1...50 {
            let delay = backoff.delay(attempt: attempt)
            let base = Backoff.baseDelay(attempt: attempt)
            XCTAssertGreaterThanOrEqual(delay, base * 0.8 - 1e-9, "attempt \(attempt)")
            XCTAssertLessThanOrEqual(delay, base * 1.2 + 1e-9, "attempt \(attempt)")
            XCTAssertEqual(delay, same.delay(attempt: attempt), "deterministic for a seed")
            if delay != other.delay(attempt: attempt) { sawDifferent = true }
        }
        XCTAssertTrue(sawDifferent, "different seeds jitter differently")
    }
}
