import Core
import CoreTestSupport
import Foundation
import H3Kit
import Location
import Persistence
import TerritoryRules
@testable import WalkFeature
import XCTest

/// T023: paging, the merge of local pending walks, statuses, and a foreign id answered with "not available".
@MainActor
final class WalkHistoryViewModelTests: XCTestCase {
    private func item(_ n: Int, finishReason: FinishReason? = .client, flags: [Core.WalkFlag] = []) -> WalkListItem {
        WalkListItem(
            walkId: "srv-\(n)",
            clientWalkId: "c-\(n)",
            status: flags.isEmpty ? .finished : .flagged,
            finishReason: finishReason,
            startedAt: Fixtures.now.addingTimeInterval(-Double(n) * 3600),
            endedAt: Fixtures.now.addingTimeInterval(-Double(n) * 3600 + 1800),
            weekId: "2026-W37",
            distanceM: 1500,
            durationS: 1800,
            hexCount: 4,
            xp: flags.isEmpty ? 15 : 0,
            scored: flags.isEmpty,
            flags: flags
        )
    }

    func testPagesNewestFirstWithLoadMore() async throws {
        let harness = try WalkHarness()
        harness.service.listResults = [
            .success(WalkListPage(items: (1...20).map { item($0) }, nextCursor: "page-2")),
            .success(WalkListPage(items: (21...25).map { item($0) }, nextCursor: nil)),
        ]
        let viewModel = WalkHistoryViewModel(service: harness.service, repository: harness.repository)
        await viewModel.load()
        XCTAssertEqual(viewModel.rows.count, 20)
        XCTAssertEqual(viewModel.rows.first?.id, "srv-1")
        XCTAssertTrue(viewModel.canLoadMore)
        guard case .list(cursor: nil, limit: 20) = harness.service.calls[0] else { return XCTFail("first page") }
        await viewModel.loadMore()
        XCTAssertEqual(viewModel.rows.count, 25)
        XCTAssertFalse(viewModel.canLoadMore)
        guard case .list(cursor: "page-2", limit: 20) = harness.service.calls[1] else { return XCTFail("second page") }
        await viewModel.loadMore()
        XCTAssertEqual(harness.service.calls.count, 2, "nothing more to load")
        XCTAssertTrue(viewModel.hasLoaded)
    }

    func testLocalPendingAndFailedWalksAreMergedOnTop() async throws {
        let harness = try WalkHarness()
        let start = harness.clock.now().addingTimeInterval(-100)
        try harness.repository.createWalk(clientWalkId: "pending", startedAt: start)
        let first = Sample(seq: 0, ts: start, lat: 54.9, lon: 23.9, hAcc: 8)
        let second = Sample(seq: 1, ts: start.addingTimeInterval(5), lat: 54.9001, lon: 23.9, hAcc: 8)
        try harness.repository.append(.init(sample: first, accepted: true, reason: nil), walkId: "pending")
        try harness.repository.append(.init(sample: second, accepted: true, reason: nil), walkId: "pending")
        try harness.repository.markFinished(WalkFinishInput(
            clientWalkId: "pending", startedAt: start, endedAt: start.addingTimeInterval(60), reason: .client,
            progress: WalkProgress(distanceM: 11, movingSeconds: 60, hexCount: 1), steps: nil,
            points: [LatLng(lat: 54.9, lon: 23.9), LatLng(lat: 54.9001, lon: 23.9)]
        ))
        try harness.repository.createWalk(clientWalkId: "c-2", startedAt: harness.clock.now().addingTimeInterval(-7200))
        harness.service.listResults = [.success(WalkListPage(items: [item(1), item(2)], nextCursor: nil))]
        let viewModel = WalkHistoryViewModel(service: harness.service, repository: harness.repository)
        await viewModel.load()
        XCTAssertEqual(viewModel.rows.map(\.id), ["pending", "c-2", "srv-1"], "local first; the server's copy of c-2 is not repeated")
        XCTAssertEqual(viewModel.rows[0].status, .pendingUpload)
        XCTAssertEqual(viewModel.rows[0].path.count, 2, "mini path from the local samples")
        XCTAssertNil(viewModel.rows[0].xp)
        XCTAssertEqual(viewModel.rows[1].status, .recording)
        XCTAssertEqual(viewModel.rows[2].xp, 15)

        let loaded = await viewModel.detail(for: viewModel.rows[0])
        let detail = try XCTUnwrap(loaded)
        XCTAssertTrue(detail.isProvisional)
        XCTAssertEqual(detail.path.count, 2)
        XCTAssertEqual(detail.distanceM, 11)
    }

    func testServerFailureKeepsLocalRowsAndReportsIt() async throws {
        let harness = try WalkHarness()
        try harness.repository.createWalk(clientWalkId: "local", startedAt: harness.clock.now())
        harness.service.listResults = [.failure(OfflineError())]
        let viewModel = WalkHistoryViewModel(service: harness.service, repository: harness.repository)
        await viewModel.load()
        XCTAssertEqual(viewModel.rows.map(\.id), ["local"])
        XCTAssertEqual(viewModel.errorMessage, Fixtures.offline.userMessage)
        XCTAssertFalse(viewModel.canLoadMore)
    }

    func testStatusLinesExplainFlaggedAndAutoFinishedWalks() async throws {
        let flagged = WalkRow(item: item(1, flags: [.teleport, .speed]))
        XCTAssertEqual(flagged.status, .flagged([.teleport, .speed]))
        XCTAssertTrue(flagged.statusLine.contains("impossible jump"))
        XCTAssertTrue(flagged.statusLine.contains("earned no metres"))
        XCTAssertEqual(flagged.xpText, "0 XP")
        let auto = WalkRow(item: item(2, finishReason: .autofinish))
        XCTAssertEqual(auto.status, .autoFinished)
        XCTAssertTrue(auto.statusLine.contains("12 hours"))
        XCTAssertEqual(WalkRow(item: item(3, finishReason: .superseded)).status, .superseded)
        XCTAssertEqual(WalkRow(item: item(4)).statusLine, "Scored")
        XCTAssertEqual(auto.distanceText, "1.5 km")
        XCTAssertEqual(auto.durationText, "30 min")
    }

    func testDetailLoadsTheServerSummaryAndForeignIdIsNotAvailable() async throws {
        let harness = try WalkHarness()
        harness.service.walkResults = [
            .success(Fixtures.walkSummary(walkId: "srv-1", clientWalkId: "c-1")),
            .failure(APIError.walkNotFound),
        ]
        let viewModel = WalkHistoryViewModel(service: harness.service, repository: harness.repository)
        let loaded = await viewModel.detail(for: WalkRow(item: item(1)))
        let detail = try XCTUnwrap(loaded)
        XCTAssertFalse(detail.isProvisional)
        XCTAssertEqual(detail.xp, 26)
        XCTAssertEqual(detail.path.count, 2, "the server's simplified path")
        XCTAssertEqual(detail.hexes.first?.shareText, "your faction 64 %")

        let foreign = await viewModel.detail(for: WalkRow(item: item(9)))
        XCTAssertNil(foreign)
        XCTAssertEqual(viewModel.errorMessage, APIError.walkNotFound.userMessage)
    }
}
