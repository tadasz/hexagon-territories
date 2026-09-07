import Foundation
import H3Kit
import TerritoryRules
import XCTest

/// Replays `walk-paths.json` through acceptSamples → walkFlags → simplifyPath → pathToHexMeters (±0.5 m).
final class WalkPathsTests: XCTestCase {
    private static let meterTolerance = 0.5

    func testAllCases() throws {
        let fixture = try loadFixture(WalkPathsFixture.self, named: "walk-paths")
        XCTAssertGreaterThanOrEqual(fixture.cases.count, 1)
        for testCase in fixture.cases {
            try check(testCase)
        }
    }

    private func check(_ testCase: WalkPathsFixture.Case) throws {
        let id = testCase.id
        let acceptance = acceptSamples(testCase.input.samples)

        XCTAssertEqual(acceptance.accepted.map(\.seq), testCase.expected.acceptedSeqs, "[\(id)] acceptedSeqs")
        XCTAssertEqual(
            acceptance.rejected.map { "\($0.seq):\($0.reason.rawValue)" },
            testCase.expected.rejected.map { "\($0.seq):\($0.reason)" },
            "[\(id)] rejected"
        )

        let flags = walkFlags(accepted: acceptance.accepted, pedometerSteps: testCase.input.pedometerSteps)
        XCTAssertEqual(flags.map(\.rawValue).sorted(), testCase.expected.flags.sorted(), "[\(id)] flags")

        let simplified = simplifyPath(acceptance.accepted.map(\.coordinate), toleranceM: testCase.input.simplifyToleranceM)
        XCTAssertEqual(simplified.count, testCase.expected.simplifiedPointCount, "[\(id)] simplifiedPointCount")
        XCTAssertEqual(
            Geo.pathLengthMeters(simplified),
            testCase.expected.distanceM,
            accuracy: Self.meterTolerance,
            "[\(id)] distanceM"
        )

        let hexMeters = try pathToHexMeters(simplified, resolution: testCase.input.resolution)
        XCTAssertEqual(
            hexMeters.map(\.cell.description),
            testCase.expected.hexMeters.map(\.cell),
            "[\(id)] hexMeters cells (sorted ascending)"
        )
        let expectedByCell = Dictionary(uniqueKeysWithValues: testCase.expected.hexMeters.map { ($0.cell, $0.meters) })
        for entry in hexMeters {
            guard let expected = expectedByCell[entry.cell.description] else {
                XCTFail("[\(id)] unexpected cell \(entry.cell) with \(entry.meters) m")
                continue
            }
            XCTAssertEqual(entry.meters, expected, accuracy: Self.meterTolerance, "[\(id)] metres in \(entry.cell)")
        }
        for cell in hexMeters {
            XCTAssertEqual(cell.cell.resolution, testCase.input.resolution, "[\(id)] resolution of \(cell.cell)")
        }
    }

    // MARK: Fixture loader diagnostics (plan.md item 11)

    func testMalformedFixtureFailsNamingTheFile() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("nature-fixtures-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("walk-paths.json")
        try Data("{".utf8).write(to: file)

        XCTAssertThrowsError(try FixtureLocator.decode(WalkPathsFixture.self, from: file)) { error in
            let message = "\(error)"
            XCTAssertTrue(message.contains("walk-paths.json"), "message names the file: \(message)")
        }
    }

    func testSchemaInvalidFixtureReportsTheJSONPath() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("nature-fixtures-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("walk-paths.json")
        let json = """
        {"name":"walk-paths","description":"","generator":"","version":1,
         "cases":[{"id":"x","input":{"resolution":9,"simplifyToleranceM":5,"samples":[{"seq":0,"ts":"2026-09-07T08:00:00Z","lat":54.9,"lon":"oops","hAcc":8}]},
         "expected":{"acceptedSeqs":[],"rejected":[],"flags":[],"distanceM":0,"simplifiedPointCount":0,"hexMeters":[]}}]}
        """
        try Data(json.utf8).write(to: file)

        XCTAssertThrowsError(try FixtureLocator.decode(WalkPathsFixture.self, from: file)) { error in
            let message = "\(error)"
            XCTAssertTrue(message.contains("walk-paths.json"), "message names the file: \(message)")
            XCTAssertTrue(message.contains("$.cases[0].input.samples[0].lon"), "message names the JSON path: \(message)")
        }
    }

    func testMissingFixtureNamesThePath() {
        XCTAssertThrowsError(try FixtureLocator.url(forFixtureNamed: "does-not-exist")) { error in
            XCTAssertTrue("\(error)".contains("does-not-exist.json"), "\(error)")
        }
    }

    // MARK: Fixture-independent unit checks

    func testSyntheticSegmentCrossingThreeCells() throws {
        // A ~600 m straight segment east of the Kaunas centre crosses several res-9 cells (edge ≈ 200 m).
        let start = LatLng(lat: 54.8985, lon: 23.9036)
        let end = LatLng(lat: 54.8985, lon: 23.9036 + 600 / (Rules.earthRadiusM * cos(54.8985 * .pi / 180)) * 180 / .pi)
        let length = Geo.distanceMeters(start, end)
        XCTAssertEqual(length, 600, accuracy: 1)

        let hexMeters = try pathToHexMeters([start, end])
        XCTAssertGreaterThanOrEqual(hexMeters.count, 2, "600 m crosses at least one res-9 boundary")
        XCTAssertLessThanOrEqual(hexMeters.count, 5)
        XCTAssertEqual(hexMeters.reduce(0) { $0 + $1.meters }, length, accuracy: 0.5, "metres are conserved")
        XCTAssertEqual(hexMeters.map(\.cell.description), hexMeters.map(\.cell.description).sorted(), "sorted by cell")
        XCTAssertTrue(hexMeters.contains { $0.cell == (try? H3.latLngToCell(start, res: 9)) })
        XCTAssertTrue(hexMeters.contains { $0.cell == (try? H3.latLngToCell(end, res: 9)) })
    }

    func testSegmentInsideOneCellIsCreditedWhole() throws {
        let cell = try H3.latLngToCell(LatLng(lat: 54.8985, lon: 23.9036), res: 9)
        let centre = try H3.cellToLatLng(cell)
        let a = LatLng(lat: centre.lat + 0.0002, lon: centre.lon)
        let b = LatLng(lat: centre.lat - 0.0002, lon: centre.lon)
        let hexMeters = try pathToHexMeters([a, b])
        XCTAssertEqual(hexMeters.count, 1)
        XCTAssertEqual(hexMeters[0].cell, cell)
        XCTAssertEqual(hexMeters[0].meters, Geo.distanceMeters(a, b), accuracy: 0.001)
    }

    func testAcceptanceOrderAndReasons() {
        let t0 = Date(timeIntervalSince1970: 1_800_000_000)
        let samples = [
            Sample(seq: 0, ts: t0, lat: 54.9, lon: 23.9, hAcc: 8, speed: 1.4),
            Sample(seq: 1, ts: t0.addingTimeInterval(5), lat: 54.9001, lon: 23.9, hAcc: 60, speed: 1.4),   // accuracy
            Sample(seq: 2, ts: t0.addingTimeInterval(10), lat: 54.9002, lon: 23.9, hAcc: 8, speed: 6),     // speed
            Sample(seq: 3, ts: t0.addingTimeInterval(10), lat: 54.9003, lon: 23.9, hAcc: 8, speed: nil),   // non_monotonic vs seq 0? no: vs last accepted (seq 0 @ t0) it's later → accepted
            Sample(seq: 4, ts: t0.addingTimeInterval(9), lat: 54.9004, lon: 23.9, hAcc: 90, speed: 9),     // non_monotonic wins over accuracy/speed
        ]
        let result = acceptSamples(samples)
        XCTAssertEqual(result.accepted.map(\.seq), [0, 3])
        XCTAssertEqual(result.rejected, [
            RejectedSample(seq: 1, reason: .accuracy),
            RejectedSample(seq: 2, reason: .speed),
            RejectedSample(seq: 4, reason: .nonMonotonic),
        ])
    }

    func testFlags() {
        let t0 = Date(timeIntervalSince1970: 1_800_000_000)
        // 400 m jump in 5 s → teleport (80 m/s); then a normal 5 s step → median of [80, ~1.4] = ~40 → speed too.
        let jump = [
            Sample(seq: 0, ts: t0, lat: 54.9, lon: 23.9, hAcc: 8),
            Sample(seq: 1, ts: t0.addingTimeInterval(5), lat: 54.9036, lon: 23.9, hAcc: 8),
            Sample(seq: 2, ts: t0.addingTimeInterval(10), lat: 54.90366, lon: 23.9, hAcc: 8),
        ]
        XCTAssertEqual(walkFlags(accepted: jump), [.speed, .teleport])
        XCTAssertEqual(walkFlags(accepted: Array(jump.prefix(1))), [])

        // 1 km at 1 m/s with 100 steps → no_steps; without a pedometer reading no flag.
        var slow: [Sample] = []
        for index in 0...200 {
            slow.append(Sample(seq: index, ts: t0.addingTimeInterval(Double(index) * 5), lat: 54.9 + Double(index) * 0.000045, lon: 23.9, hAcc: 8))
        }
        XCTAssertEqual(walkFlags(accepted: slow), [])
        XCTAssertEqual(walkFlags(accepted: slow, pedometerSteps: 100), [.noSteps])
        XCTAssertEqual(walkFlags(accepted: slow, pedometerSteps: 1500), [])
    }

    func testSimplifyKeepsEndpointsAndRemovesJitter() {
        let straight = (0...20).map { LatLng(lat: 54.9 + Double($0) * 0.0001, lon: 23.9) }
        XCTAssertEqual(simplifyPath(straight).count, 2)
        var jitter = straight
        jitter[10] = LatLng(lat: jitter[10].lat, lon: jitter[10].lon + 0.0002) // ≈ 13 m sideways
        let kept = simplifyPath(jitter)
        XCTAssertTrue(kept.contains(jitter[10]), "the 13 m spike survives a 5 m tolerance")
        XCTAssertGreaterThan(kept.count, 2)
        XCTAssertLessThan(kept.count, jitter.count)
        XCTAssertEqual(kept.first, jitter.first)
        XCTAssertEqual(kept.last, jitter.last)
        XCTAssertEqual(simplifyPath(jitter, toleranceM: 20).count, 2)
        XCTAssertEqual(simplifyPath([]).count, 0)
        XCTAssertEqual(simplifyPath([straight[0]]).count, 1)
    }

    func testHaversineKnownDistance() {
        // Kaunas town hall → Vilnius cathedral ≈ 92.6 km.
        let d = Geo.distanceMeters(LatLng(lat: 54.8969, lon: 23.8862), LatLng(lat: 54.6858, lon: 25.2877))
        XCTAssertEqual(d, 92_600, accuracy: 300)
    }
}
