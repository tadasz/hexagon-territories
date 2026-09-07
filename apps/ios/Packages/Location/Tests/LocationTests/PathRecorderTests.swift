import Foundation
import H3Kit
import Location
import LocationTestSupport
import TerritoryRules
import XCTest

/// SC-002 filter parity: with the throttle disabled, feeding every fixture sample as a fix yields exactly the
/// fixture's `acceptedSeqs` and `rejected`; plus the 5 s / 10 m throttle rules of plan.md Shared Semantics 2.
final class PathRecorderTests: XCTestCase {
    func testFixtureParityForAllSixCases() throws {
        let fixture = try WalkPathsFixture.load()
        for testCase in fixture.cases {
            var recorder = PathRecorder(throttle: .disabled)
            var accepted: [Int] = []
            var rejected: [String] = []
            for sample in testCase.input.samples {
                guard let recorded = recorder.record(sample.fix) else {
                    XCTFail("[\(testCase.id)] throttle disabled but seq \(sample.seq) was dropped")
                    continue
                }
                XCTAssertEqual(recorded.sample.seq, sample.seq, "[\(testCase.id)] seq numbering follows the input")
                if recorded.accepted {
                    accepted.append(recorded.sample.seq)
                } else {
                    rejected.append("\(recorded.sample.seq):\(recorded.reason?.rawValue ?? "nil")")
                }
            }
            XCTAssertEqual(accepted, testCase.expected.acceptedSeqs, "[\(testCase.id)] acceptedSeqs")
            XCTAssertEqual(rejected, testCase.expected.rejected.map { "\($0.seq):\($0.reason)" }, "[\(testCase.id)] rejected")
        }
    }

    func testThrottleKeepsOnePerFiveSecondsAtWalkingPace() {
        // 1 Hz fixes at 1 m/s: neither 5 s nor 10 m is reached before the 5th second.
        var recorder = PathRecorder()
        let t0 = Date(timeIntervalSince1970: 1_800_000_000)
        var kept: [Int] = []
        for second in 0..<30 {
            let fix = LocationFix(timestamp: t0.addingTimeInterval(Double(second)), lat: 54.9 + Double(second) * 0.000009, lon: 23.9, hAcc: 8, speed: 1)
            if let recorded = recorder.record(fix) {
                kept.append(second)
                XCTAssertTrue(recorded.accepted)
            }
        }
        XCTAssertEqual(kept, [0, 5, 10, 15, 20, 25])
        XCTAssertEqual(recorder.nextSeq, 6, "throttled fixes consume no seq")
    }

    func testTwelveMetreJumpWithinTwoSecondsIsKept() {
        var recorder = PathRecorder()
        let t0 = Date(timeIntervalSince1970: 1_800_000_000)
        XCTAssertNotNil(recorder.record(LocationFix(timestamp: t0, lat: 54.9, lon: 23.9, hAcc: 8)))
        XCTAssertNil(recorder.record(LocationFix(timestamp: t0.addingTimeInterval(1), lat: 54.90002, lon: 23.9, hAcc: 8)), "2 m in 1 s: throttled")
        let jump = recorder.record(LocationFix(timestamp: t0.addingTimeInterval(2), lat: 54.90011, lon: 23.9, hAcc: 8))
        XCTAssertEqual(jump?.sample.seq, 1, "12 m in 2 s: kept as seq 1")
        XCTAssertEqual(jump?.accepted, true)
    }

    func testRejectedSamplesGetASeqAndDoNotMoveTheReference() {
        var recorder = PathRecorder(throttle: .disabled)
        let t0 = Date(timeIntervalSince1970: 1_800_000_000)
        let first = recorder.record(LocationFix(timestamp: t0, lat: 54.9, lon: 23.9, hAcc: 8))
        let bad = recorder.record(LocationFix(timestamp: t0.addingTimeInterval(5), lat: 54.9001, lon: 23.9, hAcc: 80))
        let fast = recorder.record(LocationFix(timestamp: t0.addingTimeInterval(10), lat: 54.9002, lon: 23.9, hAcc: 8, speed: 6))
        let back = recorder.record(LocationFix(timestamp: t0.addingTimeInterval(-1), lat: 54.9003, lon: 23.9, hAcc: 8))
        let good = recorder.record(LocationFix(timestamp: t0.addingTimeInterval(15), lat: 54.9004, lon: 23.9, hAcc: 8))
        XCTAssertEqual(first?.accepted, true)
        XCTAssertEqual(bad?.reason, .accuracy)
        XCTAssertEqual(fast?.reason, .speed)
        XCTAssertEqual(back?.reason, .nonMonotonic)
        XCTAssertEqual(good?.accepted, true)
        XCTAssertEqual([first, bad, fast, back, good].map { $0?.sample.seq }, [0, 1, 2, 3, 4])
        XCTAssertEqual(recorder.lastAccepted?.seq, 4)
    }

    func testResumeContinuesNumbering() {
        var recorder = PathRecorder(throttle: .disabled)
        let t0 = Date(timeIntervalSince1970: 1_800_000_000)
        recorder.resume(afterSeq: 41, lastAccepted: Sample(seq: 41, ts: t0, lat: 54.9, lon: 23.9, hAcc: 8))
        let next = recorder.record(LocationFix(timestamp: t0.addingTimeInterval(5), lat: 54.9001, lon: 23.9, hAcc: 8))
        XCTAssertEqual(next?.sample.seq, 42)
        let stale = recorder.record(LocationFix(timestamp: t0.addingTimeInterval(-5), lat: 54.9001, lon: 23.9, hAcc: 8))
        XCTAssertEqual(stale?.reason, .nonMonotonic)
    }
}
