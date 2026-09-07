import Core
import CoreTestSupport
import Foundation
import XCTest

/// Decodes the walk examples of `specs/003-walk-tracking/contracts/openapi.yaml` verbatim with `JSONCoding` (T014).
final class WalkModelsCodingTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONCoding.decoder().decode(type, from: Data(json.utf8))
    }

    /// The `POST /v1/walks/{id}/finish` 200 example, as written in the contract.
    static let finishExample = """
    {
      "walkId": "2f9b7c1e-1b2c-4d3e-9f0a-1a2b3c4d5e6f",
      "clientWalkId": "6d1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b",
      "status": "finished",
      "finishReason": "client",
      "startedAt": "2026-09-07T08:00:00.000Z",
      "endedAt": "2026-09-07T08:35:10.000Z",
      "finishedAt": "2026-09-07T08:35:12.417Z",
      "weekId": "2026-W37",
      "distanceM": 2611.4,
      "durationS": 2110,
      "steps": 3400,
      "sampleCount": 422,
      "hexCount": 5,
      "xp": 26,
      "scored": true,
      "flags": [],
      "hexes": [
        { "h3": "891f40d1a4fffff", "meters": 812.3, "cappedMeters": 812.3,
          "weekStanding": { "leader": 1, "myFactionShare": 0.64, "owner": null } }
      ],
      "path": { "type": "LineString", "coordinates": [[23.9320, 54.9035], [23.9331, 54.9041]] }
    }
    """

    func testFinishExampleDecodesVerbatim() throws {
        let summary = try decode(WalkSummary.self, Self.finishExample)
        XCTAssertEqual(summary.hexCount, 5)
        XCTAssertEqual(summary.weekId, "2026-W37")
        XCTAssertEqual(summary.status, .finished)
        XCTAssertEqual(summary.finishReason, .client)
        XCTAssertEqual(summary.xp, 26)
        XCTAssertTrue(summary.scored)
        XCTAssertEqual(summary.flags, [])
        XCTAssertEqual(summary.hexes.count, 1)
        XCTAssertEqual(summary.hexes[0].h3, "891f40d1a4fffff")
        XCTAssertEqual(summary.hexes[0].weekStanding.leader, 1)
        XCTAssertNil(summary.hexes[0].weekStanding.owner)
        XCTAssertEqual(summary.hexes[0].weekStanding.myFactionShare, 0.64, accuracy: 1e-9)
        XCTAssertEqual(summary.path?.coordinates.count, 2)
        XCTAssertEqual(summary.path?.latLonPairs.first?.lat, 54.9035)
        XCTAssertEqual(summary.startedAt, JSONCoding.parseISO8601("2026-09-07T08:00:00Z"))
        XCTAssertEqual(summary.finishedAt, JSONCoding.parseISO8601("2026-09-07T08:35:12.417Z"))
        XCTAssertFalse(summary.isFlagged)
    }

    func testSummaryRoundTrips() throws {
        let original = try decode(WalkSummary.self, Self.finishExample)
        let data = try JSONCoding.encoder().encode(original)
        let again = try JSONCoding.decoder().decode(WalkSummary.self, from: data)
        XCTAssertEqual(again, original)
        let text = try XCTUnwrap(String(data: data, encoding: .utf8))
        XCTAssertTrue(text.contains("\"finishedAt\":\"2026-09-07T08:35:12.417Z\""), text)
    }

    func testActiveWalkWithNullsDecodes() throws {
        let json = """
        {"walkId":"w","clientWalkId":"c","status":"active","finishReason":null,"startedAt":"2026-09-07T08:00:00Z",
         "endedAt":null,"finishedAt":null,"weekId":null,"distanceM":0,"durationS":0,"steps":null,"sampleCount":0,
         "hexCount":0,"xp":0,"scored":false,"flags":[],"hexes":[],"path":null}
        """
        let summary = try decode(WalkSummary.self, json)
        XCTAssertEqual(summary.status, .active)
        XCTAssertNil(summary.finishReason)
        XCTAssertNil(summary.path)
        XCTAssertNil(summary.steps)
    }

    func testFlaggedSummaryDecodesFlags() throws {
        var json = Self.finishExample
        json = json.replacingOccurrences(of: "\"status\": \"finished\"", with: "\"status\": \"flagged\"")
        json = json.replacingOccurrences(of: "\"flags\": []", with: "\"flags\": [\"teleport\", \"no_steps\"]")
        let summary = try decode(WalkSummary.self, json)
        XCTAssertEqual(summary.flags, [.teleport, .noSteps])
        XCTAssertTrue(summary.isFlagged)
        XCTAssertEqual(WalkFlag.noSteps.rawValue, "no_steps")
    }

    func testCreatedAndListPageDecode() throws {
        let created = try decode(WalkCreated.self, """
        {"walkId":"2f9b7c1e-1b2c-4d3e-9f0a-1a2b3c4d5e6f","clientWalkId":"6d1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b",
         "startedAt":"2026-09-07T08:00:00.000Z","status":"active","supersededWalkId":null}
        """)
        XCTAssertEqual(created.status, .active)
        XCTAssertNil(created.supersededWalkId)

        let page = try decode(WalkListPage.self, """
        {"items":[{"walkId":"w1","clientWalkId":"c1","status":"finished","finishReason":"autofinish",
         "startedAt":"2026-09-06T08:00:00Z","endedAt":"2026-09-06T08:30:00Z","weekId":"2026-W36","distanceM":1200.5,
         "durationS":1800,"hexCount":3,"xp":12,"scored":true,"flags":[]}],"nextCursor":"abc"}
        """)
        XCTAssertEqual(page.items.count, 1)
        XCTAssertEqual(page.items[0].finishReason, .autofinish)
        XCTAssertEqual(page.nextCursor, "abc")
    }

    func testBatchResultDecodesRejectReasons() throws {
        let result = try decode(SampleBatchResult.self, """
        {"stored":198,"duplicates":2,"accepted":[0,1,2,3],"rejected":[{"seq":4,"reason":"accuracy"},
         {"seq":5,"reason":"non_monotonic"}],"sampleCount":200}
        """)
        XCTAssertEqual(result.stored, 198)
        XCTAssertEqual(result.rejected.map(\.reason), [.accuracy, .nonMonotonic])
    }

    func testRequestsEncodeAsTheContractExpects() throws {
        let encoder = JSONCoding.encoder()
        let create = WalkCreateRequest(
            clientWalkId: "c",
            startedAt: Fixtures.now,
            deviceInfo: DeviceInfo(model: String(repeating: "x", count: 100), osVersion: "17.5", appVersion: nil)
        )
        let createText = try XCTUnwrap(String(data: try encoder.encode(create), encoding: .utf8))
        XCTAssertTrue(createText.contains("\"startedAt\":\"2026-09-07T10:00:00.000Z\""), createText)
        XCTAssertEqual(create.deviceInfo?.model?.count, 64, "model truncated to the contract's maxLength")
        XCTAssertFalse(createText.contains("appVersion"), "nil optionals are omitted")

        let sample = LocationSample(seq: 0, ts: Fixtures.now, lat: 54.9, lon: 23.9, hAcc: 8, speed: 1.4)
        let batchText = try XCTUnwrap(String(data: try encoder.encode(SampleBatchRequest(samples: [sample])), encoding: .utf8))
        XCTAssertTrue(batchText.contains("\"hAcc\":8"), batchText)
        XCTAssertFalse(batchText.contains("course"), batchText)
        XCTAssertFalse(batchText.contains("pedometer"), batchText)

        let finish = WalkFinishRequest(endedAt: Fixtures.now, pedometerTotal: nil)
        let finishText = try XCTUnwrap(String(data: try encoder.encode(finish), encoding: .utf8))
        XCTAssertEqual(finishText, "{\"endedAt\":\"2026-09-07T10:00:00.000Z\"}")
        XCTAssertEqual(SampleBatchRequest.maxSamples, 200)
    }

    func testListItemProjection() {
        let summary = Fixtures.walkSummary()
        let item = summary.listItem
        XCTAssertEqual(item.walkId, summary.walkId)
        XCTAssertEqual(item.hexCount, 1)
        XCTAssertEqual(item.xp, 26)
    }
}
