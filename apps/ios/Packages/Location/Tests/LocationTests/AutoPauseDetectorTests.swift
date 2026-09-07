import Foundation
import H3Kit
import Location
import LocationTestSupport
import XCTest

final class AutoPauseDetectorTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)
    private let origin = LatLng(lat: 54.9, lon: 23.9)

    /// `metres` north of the origin.
    private func north(_ metres: Double) -> LatLng {
        LatLng(lat: 54.9 + metres / 111_195, lon: 23.9)
    }

    func testPausesAfterThreeMinutesWithoutMovement() {
        var detector = AutoPauseDetector()
        detector.start(at: t0)
        XCTAssertNil(detector.observe(origin, at: t0))
        XCTAssertNil(detector.tick(now: t0.addingTimeInterval(179)))
        XCTAssertFalse(detector.isPaused)
        XCTAssertEqual(detector.tick(now: t0.addingTimeInterval(180)), .paused)
        XCTAssertTrue(detector.isPaused)
        XCTAssertNil(detector.tick(now: t0.addingTimeInterval(400)), "reported once")
        XCTAssertEqual(detector.movingSeconds, 180, "moving time stops at the pause")
    }

    func testSmallJitterDoesNotCountAsMovement() {
        var detector = AutoPauseDetector()
        detector.start(at: t0)
        _ = detector.observe(origin, at: t0)
        for step in 1...20 {
            XCTAssertNil(detector.observe(north(Double(step % 3) * 3), at: t0.addingTimeInterval(Double(step) * 5)), "jitter < 10 m")
        }
        XCTAssertEqual(detector.observe(north(0), at: t0.addingTimeInterval(180)), .paused)
    }

    func testTenMetreMovesEveryMinuteNeverPause() {
        var detector = AutoPauseDetector()
        detector.start(at: t0)
        var position = 0.0
        for minute in 0..<30 {
            position += 10
            XCTAssertNil(detector.observe(north(position), at: t0.addingTimeInterval(Double(minute) * 60)))
            XCTAssertNil(detector.tick(now: t0.addingTimeInterval(Double(minute) * 60 + 30)))
        }
        XCTAssertFalse(detector.isPaused)
        XCTAssertEqual(detector.movingSeconds, 29 * 60 + 30, accuracy: 0.001)
    }

    func testResumesOnTheFirstMoveAndExcludesThePause() {
        var detector = AutoPauseDetector()
        detector.start(at: t0)
        _ = detector.observe(origin, at: t0)
        XCTAssertEqual(detector.tick(now: t0.addingTimeInterval(180)), .paused)
        XCTAssertNil(detector.tick(now: t0.addingTimeInterval(600)))
        XCTAssertNil(detector.observe(north(4), at: t0.addingTimeInterval(650)), "4 m: still paused")
        XCTAssertEqual(detector.observe(north(12), at: t0.addingTimeInterval(700)), .resumed)
        XCTAssertFalse(detector.isPaused)
        XCTAssertEqual(detector.movingSeconds, 180, "nothing added during the pause")
        XCTAssertNil(detector.tick(now: t0.addingTimeInterval(760)))
        XCTAssertEqual(detector.movingSeconds, 240, "counting again after the resume")
        XCTAssertEqual(detector.tick(now: t0.addingTimeInterval(880)), .paused, "180 s after the resume move")
    }

    func testNoSampleAtAllPausesFromStart() {
        var detector = AutoPauseDetector()
        detector.start(at: t0)
        XCTAssertNil(detector.tick(now: t0.addingTimeInterval(100)))
        XCTAssertEqual(detector.tick(now: t0.addingTimeInterval(180)), .paused, "cold GPS for 3 minutes counts as stationary")
    }

    func testStartWithCarriedMovingSeconds() {
        var detector = AutoPauseDetector(pauseAfterS: 60, minMoveM: 5)
        detector.start(at: t0, movingSeconds: 300)
        XCTAssertEqual(detector.movingSeconds, 300)
        _ = detector.observe(origin, at: t0)
        XCTAssertEqual(detector.tick(now: t0.addingTimeInterval(60)), .paused)
        XCTAssertEqual(detector.movingSeconds, 360)
    }
}
