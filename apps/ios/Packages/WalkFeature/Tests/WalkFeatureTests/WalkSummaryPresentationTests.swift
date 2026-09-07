import Core
import CoreTestSupport
import Foundation
import H3Kit
import Location
import TerritoryRules
@testable import WalkFeature
import XCTest

final class WalkSummaryPresentationTests: XCTestCase {
    func testServerSummaryPresentation() {
        let presentation = WalkSummaryPresentation(server: Fixtures.walkSummary())
        XCTAssertFalse(presentation.isProvisional)
        XCTAssertEqual(presentation.distanceText, "2.61 km")
        XCTAssertEqual(presentation.durationText, "35 min")
        XCTAssertEqual(presentation.xpText, "26 XP")
        XCTAssertEqual(presentation.statusLine, "Scored for week 2026-W37.")
        XCTAssertNil(presentation.flagsBanner)
        XCTAssertEqual(presentation.metersColumnTitle, "metres")
        let hex = presentation.hexes[0]
        XCTAssertEqual(hex.shortId, "0d1a4")
        XCTAssertEqual(HUDState.shortCellId("891f40dabb3ffff"), "dabb3")
        XCTAssertEqual(HUDState.shortCellId("fffff"), "fffff")
        XCTAssertEqual(hex.metersText, "812 m")
        XCTAssertEqual(hex.countedText, "812 m counted")
        XCTAssertEqual(hex.shareText, "your faction 64 %")
        XCTAssertEqual(hex.leaderFactionId, 1)
        XCTAssertEqual(presentation.path.count, 2)
    }

    func testFlaggedSummaryBanner() {
        let presentation = WalkSummaryPresentation(server: Fixtures.walkSummary(flags: [.teleport, .noSteps]))
        XCTAssertTrue(presentation.isFlagged)
        XCTAssertEqual(
            presentation.flagsBanner,
            "This walk was flagged (an impossible jump between two positions, too few steps for the distance) and earned no metres."
        )
        XCTAssertEqual(presentation.statusLine, "Flagged — earned no metres.")
        XCTAssertEqual(presentation.xpText, "0 XP")
        XCTAssertEqual(presentation.hexes[0].cappedMeters, 0)
    }

    func testProvisionalPresentationLabelsEstimates() {
        let input = WalkFinishInput(
            clientWalkId: "c",
            startedAt: Fixtures.now,
            endedAt: Fixtures.now.addingTimeInterval(4000),
            reason: .client,
            progress: WalkProgress(
                distanceM: 950,
                movingSeconds: 3700,
                hexCount: 2,
                hexEstimates: [HexMeters(cell: H3Index(string: "891f40d1a4fffff")!, meters: 500.4)]
            ),
            steps: nil,
            points: []
        )
        let presentation = WalkSummaryPresentation(provisional: ProvisionalSummary(input))
        XCTAssertTrue(presentation.isProvisional)
        XCTAssertEqual(presentation.distanceText, "950 m")
        XCTAssertEqual(presentation.durationText, "1 h 1 min")
        XCTAssertEqual(presentation.xpText, "XP pending")
        XCTAssertEqual(presentation.metersColumnTitle, "≈ metres (estimate)")
        XCTAssertTrue(presentation.statusLine.contains("estimates"))
        XCTAssertNil(presentation.hexes[0].cappedMeters)
        XCTAssertNil(presentation.hexes[0].shareText)
    }

    func testAutoFinishedAndSupersededStatusLines() {
        XCTAssertTrue(WalkSummaryPresentation(server: Fixtures.walkSummary(finishReason: .autofinish)).statusLine.contains("12 hours"))
        XCTAssertTrue(WalkSummaryPresentation(server: Fixtures.walkSummary(finishReason: .superseded)).statusLine.contains("newer walk"))
    }
}
