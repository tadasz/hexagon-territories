import Core
import CoreTestSupport
import Foundation
import XCTest

final class FactionChangeLockTests: XCTestCase {
    private let clock = FakeClock()
    private let english = Locale(identifier: "en_US")

    func testNoDateIsFree() {
        XCTAssertEqual(FactionChangeLock(nextChangeAt: nil, now: clock.now()), .free)
        XCTAssertEqual(FactionChangeLock(me: nil, clock: clock), .free)
        XCTAssertEqual(FactionChangeLock(me: Fixtures.me(), clock: clock), .free)
    }

    func testPastDateIsFree() {
        let past = clock.now().addingTimeInterval(-1)
        XCTAssertEqual(FactionChangeLock(nextChangeAt: past, now: clock.now()), .free)
        XCTAssertEqual(FactionChangeLock(nextChangeAt: clock.now(), now: clock.now()), .free, "exactly now is allowed")
    }

    func testFutureDateIsLocked() {
        let until = clock.now().addingTimeInterval(30 * 86_400)
        let lock = FactionChangeLock(me: Fixtures.me(factionChangeAvailableAt: until), clock: clock)
        XCTAssertEqual(lock, .locked(until: until))
        XCTAssertTrue(lock.isLocked)
        XCTAssertEqual(lock.until, until)
    }

    func testMessageNamesTheDateAndDays() throws {
        let until = clock.now().addingTimeInterval(30 * 86_400)
        let message = try XCTUnwrap(FactionChangeLock.locked(until: until).message(relativeTo: clock.now(), locale: english))
        XCTAssertTrue(message.contains("30 days"), message)
        XCTAssertTrue(message.contains("Oct 7, 2026"), message)
        XCTAssertNil(FactionChangeLock.free.message(relativeTo: clock.now(), locale: english))
    }

    func testMessageForLessThanADay() throws {
        let until = clock.now().addingTimeInterval(3_600)
        let message = try XCTUnwrap(FactionChangeLock.locked(until: until).message(relativeTo: clock.now(), locale: english))
        XCTAssertTrue(message.contains("tomorrow"), message)
    }
}
