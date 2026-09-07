import Foundation
import H3Kit
import Location
import LocationTestSupport
import TerritoryRules
import XCTest

/// SC-002 / research.md R19: the incremental estimate equals one batch `pathToHexMeters(rawAccepted)` call
/// (±0.5 m per cell) for every case, and the fixture's `hexMeters` for the cases whose simplified path is the raw one.
final class HexMetersEstimatorTests: XCTestCase {
    private static let tolerance = 0.5

    private func estimate(_ testCase: WalkPathsFixture.Case) throws -> (HexMetersEstimator, [Sample]) {
        let accepted = acceptSamples(testCase.input.samples).accepted
        var estimator = HexMetersEstimator(resolution: testCase.input.resolution)
        for sample in accepted {
            try estimator.add(sample.coordinate)
        }
        return (estimator, accepted)
    }

    func testIncrementalEqualsBatchForAllCases() throws {
        let fixture = try WalkPathsFixture.load()
        var maxDeviation = 0.0
        for testCase in fixture.cases {
            let (estimator, accepted) = try estimate(testCase)
            let batch = try pathToHexMeters(accepted.map(\.coordinate), resolution: testCase.input.resolution)
            let incremental = estimator.snapshot()
            XCTAssertEqual(incremental.map(\.cell), batch.map(\.cell), "[\(testCase.id)] cells")
            let batchByCell = Dictionary(uniqueKeysWithValues: batch.map { ($0.cell, $0.meters) })
            for entry in incremental {
                let expected = batchByCell[entry.cell] ?? -1
                maxDeviation = max(maxDeviation, abs(entry.meters - expected))
                XCTAssertEqual(entry.meters, expected, accuracy: Self.tolerance, "[\(testCase.id)] \(entry.cell)")
            }
            XCTAssertEqual(
                estimator.distanceM,
                Geo.pathLengthMeters(accepted.map(\.coordinate)),
                accuracy: Self.tolerance,
                "[\(testCase.id)] raw distance"
            )
            XCTAssertEqual(estimator.points.count, accepted.count)
        }
        print("HexMetersEstimator incremental vs batch: max deviation \(maxDeviation) m")
        XCTAssertLessThan(maxDeviation, Self.tolerance)
    }

    /// `teleport` has no jitter, so its raw path *is* the two-point simplified path and the estimate equals the
    /// fixture within 0.5 m. `straight-line` and `car-speed` also simplify to two points, but their raw samples carry
    /// sub-tolerance jitter (≈ 1 % extra length) which Douglas–Peucker removes on the server and the live estimate
    /// keeps (research.md R19): the cells are identical and every cell is within 1 % of the walk's length of the
    /// fixture value, which is the raw-vs-simplified gap the HUD's "estimate" label stands for.
    func testMatchesFixtureWhereSimplifiedPathIsRaw() throws {
        let fixture = try WalkPathsFixture.load()
        for id in ["straight-line", "teleport", "car-speed"] {
            let testCase = try fixture.caseNamed(id)
            XCTAssertEqual(testCase.expected.simplifiedPointCount, 2, "[\(id)] precondition: a single simplified segment")
            let (estimator, _) = try estimate(testCase)
            let snapshot = estimator.snapshot()
            XCTAssertEqual(snapshot.map(\.cell.description), testCase.expected.hexMeters.map(\.cell), "[\(id)] cells")
            let rawExcess = estimator.distanceM - testCase.expected.distanceM
            XCTAssertGreaterThanOrEqual(rawExcess, -Self.tolerance, "[\(id)] the raw path is never shorter than the simplified one")
            let tolerance = id == "teleport" ? Self.tolerance : max(Self.tolerance, testCase.expected.distanceM * 0.01)
            let expectedByCell = Dictionary(uniqueKeysWithValues: testCase.expected.hexMeters.map { ($0.cell, $0.meters) })
            var maxDeviation = 0.0
            for entry in snapshot {
                let expected = expectedByCell[entry.cell.description] ?? -1
                maxDeviation = max(maxDeviation, abs(entry.meters - expected))
                XCTAssertEqual(entry.meters, expected, accuracy: tolerance, "[\(id)] \(entry.cell)")
            }
            XCTAssertEqual(estimator.distanceM, testCase.expected.distanceM, accuracy: tolerance, "[\(id)] distance")
            XCTAssertEqual(
                snapshot.reduce(0) { $0 + $1.meters },
                estimator.distanceM,
                accuracy: Self.tolerance,
                "[\(id)] metres are conserved"
            )
            print("HexMetersEstimator vs fixture [\(id)]: raw excess \(rawExcess) m, max cell deviation \(maxDeviation) m")
        }
    }

    func testLoopStaysInOneCellAndEdgeHuggingTouchesTwo() throws {
        let fixture = try WalkPathsFixture.load()
        let loop = try estimate(try fixture.caseNamed("loop-inside-one-cell")).0
        XCTAssertEqual(loop.snapshot().count, 1)
        XCTAssertEqual(loop.hexCount, 1)
        XCTAssertEqual(loop.snapshot().first?.cell.description, "891f40dabb3ffff")
        XCTAssertEqual(loop.currentCell?.description, "891f40dabb3ffff")

        let edge = try fixture.caseNamed("edge-hugging")
        let estimator = try estimate(edge).0
        XCTAssertEqual(estimator.snapshot().map(\.cell.description), edge.expected.hexMeters.map(\.cell))
        XCTAssertEqual(estimator.hexCount, 2)
    }

    func testCurrentCellAndMetersFollowTheLastPoint() throws {
        var estimator = HexMetersEstimator()
        XCTAssertNil(estimator.currentCell)
        XCTAssertEqual(estimator.currentCellMeters, 0)
        let start = LatLng(lat: 54.8985, lon: 23.9036)
        try estimator.add(start)
        XCTAssertEqual(estimator.currentCell, try H3.latLngToCell(start, res: 9))
        XCTAssertEqual(estimator.hexCount, 1, "the first cell counts as visited before any metres")
        XCTAssertEqual(estimator.snapshot(), [], "no metres yet")
        let east = LatLng(lat: 54.8985, lon: 23.9036 + 600 / (Rules.earthRadiusM * cos(54.8985 * .pi / 180)) * 180 / .pi)
        try estimator.add(east)
        XCTAssertEqual(estimator.currentCell, try H3.latLngToCell(east, res: 9))
        XCTAssertGreaterThan(estimator.currentCellMeters, 0)
        XCTAssertGreaterThanOrEqual(estimator.hexCount, 2)
        XCTAssertEqual(estimator.snapshot().reduce(0) { $0 + $1.meters }, estimator.distanceM, accuracy: 0.5)
        estimator.reset()
        XCTAssertEqual(estimator, HexMetersEstimator())
    }
}
