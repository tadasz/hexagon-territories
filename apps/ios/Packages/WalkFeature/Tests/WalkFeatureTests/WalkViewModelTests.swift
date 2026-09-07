import Core
import CoreTestSupport
import Foundation
import Location
import LocationTestSupport
import Persistence
@testable import WalkFeature
import XCTest

/// T022: start/stop with the outbox, provisional → server summary, permission and faction gates, auto-end,
/// recovery, and a lost location source.
@MainActor
final class WalkViewModelTests: XCTestCase {
    func testStartCreatesTheOutboxItemAndRecords() async throws {
        let harness = try WalkHarness()
        let viewModel = harness.makeViewModel()
        XCTAssertTrue(viewModel.canStart)
        await viewModel.start()
        XCTAssertEqual(viewModel.phase, .recording)
        XCTAssertTrue(viewModel.isRecording)
        XCTAssertFalse(viewModel.canStart)
        let walks = try harness.repository.localWalks(limit: 5)
        XCTAssertEqual(walks.count, 1)
        XCTAssertEqual(walks[0].status, .recording)
        let items = try harness.outbox.items(walkId: walks[0].id)
        XCTAssertEqual(items.map(\.kind), [.create])
        let request = try JSONCoding.decoder().decode(WalkCreateRequest.self, from: items[0].payload)
        XCTAssertEqual(request.clientWalkId, walks[0].id)
        XCTAssertEqual(request.startedAt, harness.clock.now())
        XCTAssertEqual(request.deviceInfo?.model, "iPhone14,5")
        XCTAssertEqual(harness.source.startCalls, 1)
        XCTAssertEqual(harness.permission.requests, 0, "already granted: not asked again")
        XCTAssertTrue(viewModel.hud.waitingForGPS)
        await viewModel.stop()
    }

    func testHudFollowsAcceptedFixes() async throws {
        let harness = try WalkHarness()
        let viewModel = harness.makeViewModel()
        await viewModel.start()
        await harness.tracker.ingest(harness.fix(north: 0))
        harness.clock.advance(by: 30)
        await harness.tracker.ingest(harness.fix(north: 40))
        XCTAssertFalse(viewModel.hud.waitingForGPS)
        XCTAssertEqual(viewModel.hud.distanceM, 40, accuracy: 0.5)
        XCTAssertEqual(viewModel.hud.movingSeconds, 30)
        XCTAssertEqual(viewModel.hud.hexCount, 1)
        XCTAssertTrue(viewModel.hud.currentCellText.contains("(estimate)"))
        XCTAssertNotNil(viewModel.hud.currentCellShortId)
        await viewModel.stop()
    }

    func testStopQueuesTheFinishAndShowsProvisionalThenServerSummary() async throws {
        let harness = try WalkHarness()
        let viewModel = harness.makeViewModel()
        await viewModel.start()
        let walkId = try XCTUnwrap(harness.repository.localWalks(limit: 1).first?.id)
        await harness.tracker.ingest(harness.fix(north: 0))
        harness.clock.advance(by: 20)
        await harness.tracker.ingest(harness.fix(north: 30))
        harness.clock.advance(by: 5)

        await viewModel.stop()

        XCTAssertEqual(viewModel.phase, .summary)
        let provisional = try XCTUnwrap(viewModel.summary)
        XCTAssertTrue(provisional.isProvisional)
        XCTAssertEqual(provisional.clientWalkId, walkId)
        XCTAssertEqual(provisional.distanceM, 30, accuracy: 0.5)
        XCTAssertEqual(provisional.durationS, 25)
        XCTAssertEqual(provisional.hexCount, 1)
        XCTAssertNil(provisional.xp)
        XCTAssertEqual(provisional.steps, 1200)
        XCTAssertTrue(provisional.statusLine.contains("Pending upload"))
        XCTAssertEqual(try harness.outbox.items(walkId: walkId).map(\.kind), [.create, .samples, .finish])
        XCTAssertEqual(viewModel.pendingUploads, 3)
        XCTAssertEqual(try harness.repository.localWalk(id: walkId)?.status, .finished)

        // Connectivity: the drain delivers the three items; the server summary replaces the estimate.
        await harness.sync.drain()
        await harness.wait { viewModel.summary?.isProvisional == false }
        let server = try XCTUnwrap(viewModel.summary)
        XCTAssertFalse(server.isProvisional)
        XCTAssertEqual(server.xp, 26)
        XCTAssertEqual(server.serverWalkId, "server-\(walkId)")
        XCTAssertEqual(server.hexes.first?.cappedMeters, 812.3)
        XCTAssertEqual(server.hexes.first?.leaderFactionId, 1)
        await harness.wait { viewModel.pendingUploads == 0 }
        XCTAssertEqual(viewModel.pendingUploads, 0)
        XCTAssertEqual(harness.service.finishCalls.first?.request.pedometerTotal, 1200)

        viewModel.dismissSummary()
        XCTAssertEqual(viewModel.phase, .idle)
        XCTAssertNil(viewModel.summary)
    }

    func testPermanentUploadFailureIsShownOnTheSummary() async throws {
        let harness = try WalkHarness()
        harness.service.createResults = [.failure(APIError.walkOverlap(activeWalkId: "other"))]
        let viewModel = harness.makeViewModel()
        await viewModel.start()
        await harness.tracker.ingest(harness.fix(north: 0))
        await viewModel.stop()
        await harness.sync.drain()
        await harness.wait { viewModel.summary?.uploadFailure != nil }
        XCTAssertEqual(viewModel.summary?.uploadFailure, "WALK_OVERLAP")
        XCTAssertTrue(viewModel.summary?.statusLine.contains("Upload failed") ?? false)
    }

    func testDeniedPermissionShowsTheSettingsPromptAndCreatesNoWalk() async throws {
        let harness = try WalkHarness(permission: .denied)
        let viewModel = harness.makeViewModel()
        await viewModel.start()
        XCTAssertEqual(viewModel.phase, .permissionDenied(.denied))
        XCTAssertTrue(viewModel.canStart, "the player can retry after changing Settings")
        XCTAssertEqual(try harness.repository.localWalks(limit: 5).count, 0)
        XCTAssertEqual(try harness.outbox.pendingCount(), 0)
        XCTAssertEqual(harness.source.startCalls, 0)
    }

    func testNotDeterminedAsksOnceThenStarts() async throws {
        let harness = try WalkHarness(permission: .notDetermined, afterRequest: .whenInUse)
        let viewModel = harness.makeViewModel()
        await viewModel.start()
        XCTAssertEqual(harness.permission.requests, 1)
        XCTAssertEqual(viewModel.phase, .recording)
        await viewModel.stop()

        let refused = try WalkHarness(permission: .notDetermined, afterRequest: .denied)
        let refusedModel = refused.makeViewModel()
        await refusedModel.start()
        XCTAssertEqual(refusedModel.phase, .permissionDenied(.denied))
    }

    func testNoFactionIsRefusedBeforeAnythingElse() async throws {
        let harness = try WalkHarness(permission: .notDetermined)
        harness.hasFaction.value = false
        let viewModel = harness.makeViewModel()
        await viewModel.start()
        XCTAssertEqual(viewModel.phase, .needsFaction)
        XCTAssertEqual(harness.permission.requests, 0, "no permission prompt without a faction")
        XCTAssertEqual(try harness.outbox.pendingCount(), 0)
    }

    func testSourceFailureIsReported() async throws {
        let harness = try WalkHarness()
        harness.source.startError = .notAuthorized
        let viewModel = harness.makeViewModel()
        await viewModel.start()
        guard case let .failed(message) = viewModel.phase else { return XCTFail("expected failed, got \(viewModel.phase)") }
        XCTAssertTrue(message.lowercased().contains("location"))
        XCTAssertTrue(viewModel.canStart)
    }

    func testAutoPauseAndResumeMirrorThePhase() async throws {
        let harness = try WalkHarness()
        let viewModel = harness.makeViewModel()
        await viewModel.start()
        await harness.tracker.ingest(harness.fix(north: 0))
        harness.clock.advance(by: 180)
        await viewModel.handleTick()
        await harness.wait { viewModel.phase == .paused }
        XCTAssertEqual(viewModel.phase, .paused)
        XCTAssertTrue(viewModel.hud.isPaused)
        harness.clock.advance(by: 60)
        await harness.tracker.ingest(harness.fix(north: 25))
        await harness.wait { viewModel.phase == .recording }
        XCTAssertEqual(viewModel.phase, .recording)
        XCTAssertFalse(viewModel.hud.isPaused)
        await viewModel.stop()
    }

    func testSixHoursAutoEndsAndShowsTheSummary() async throws {
        let harness = try WalkHarness()
        let viewModel = harness.makeViewModel()
        await viewModel.start()
        let walkId = try XCTUnwrap(harness.repository.localWalks(limit: 1).first?.id)
        await harness.tracker.ingest(harness.fix(north: 0))
        harness.clock.advance(by: 6 * 3600)
        await viewModel.handleTick()
        await harness.wait { viewModel.phase == .summary }
        XCTAssertEqual(viewModel.phase, .summary)
        XCTAssertTrue(viewModel.notice?.contains("6 hours") ?? false, viewModel.notice ?? "nil")
        XCTAssertEqual(try harness.outbox.items(walkId: walkId).map(\.kind), [.create, .samples, .finish])
        XCTAssertEqual(viewModel.summary?.durationS, 180, "moving time stopped at the pause")
    }

    func testLostLocationSourceStopsAndSavesTheWalk() async throws {
        let harness = try WalkHarness()
        let viewModel = harness.makeViewModel()
        await viewModel.start()
        await harness.tracker.ingest(harness.fix(north: 0))
        harness.source.end(throwing: LocationSourceError.notAuthorized)
        await harness.wait { viewModel.phase == .summary }
        XCTAssertEqual(viewModel.phase, .summary)
        XCTAssertTrue(viewModel.notice?.contains("Location access") ?? false, viewModel.notice ?? "nil")
        XCTAssertEqual(try harness.outbox.pendingCount(), 3)
    }

    func testRecoverIfNeededQueuesTheFinishOfAnInterruptedWalk() async throws {
        let harness = try WalkHarness()
        let start = harness.clock.now().addingTimeInterval(-900)
        try harness.repository.createWalk(clientWalkId: "crashed", startedAt: start)
        let sample = RecordedSample(sample: .init(seq: 0, ts: start.addingTimeInterval(60), lat: 54.9, lon: 23.9, hAcc: 8), accepted: true, reason: nil)
        try harness.repository.append(sample, walkId: "crashed")
        let viewModel = harness.makeViewModel()
        let recovered = await viewModel.recoverIfNeeded()
        XCTAssertTrue(recovered)
        XCTAssertEqual(viewModel.phase, .summary)
        XCTAssertEqual(viewModel.summary?.clientWalkId, "crashed")
        XCTAssertEqual(viewModel.summary?.endedAt, start.addingTimeInterval(60), "ended at the last kept sample")
        XCTAssertEqual(try harness.outbox.items(walkId: "crashed").map(\.kind), [.samples, .finish])
        XCTAssertEqual(try harness.repository.localWalk(id: "crashed")?.status, .finished)
        let again = await viewModel.recoverIfNeeded()
        XCTAssertFalse(again)
    }
}
