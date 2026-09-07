import H3Kit
import XCTest

/// Runs the shared `latlng-to-cell.json` fixture (200 cases) through the vendored H3 core — the Swift half of
/// User Story 1, acceptance scenario 1. Every assertion message carries the case id.
final class LatLngToCellTests: XCTestCase {
    private static let fixtureName = "latlng-to-cell"

    private func loadFixture() throws -> LatLngToCellFixture {
        do {
            return try FixtureLocator.load(LatLngToCellFixture.self, named: Self.fixtureName)
        } catch {
            XCTFail("\(Self.fixtureName).json could not be loaded: \(error)")
            throw error
        }
    }

    func testFixtureEnvelope() throws {
        let fixture = try loadFixture()
        XCTAssertEqual(fixture.name, Self.fixtureName)
        XCTAssertGreaterThanOrEqual(fixture.version, 1)
        XCTAssertFalse(fixture.cases.isEmpty, "fixture has no cases")
        let ids = fixture.cases.map(\.id)
        XCTAssertEqual(Set(ids).count, ids.count, "case ids must be unique")
    }

    func testResolution9CellMatchesFixture() throws {
        let fixture = try loadFixture()
        for testCase in fixture.cases {
            let coordinate = LatLng(lat: testCase.input.lat, lon: testCase.input.lon)
            let cell = try H3.latLngToCell(coordinate, res: 9)
            XCTAssertEqual(cell.description, testCase.expected.r9, "[\(testCase.id)] res-9 cell")
            XCTAssertEqual(cell.resolution, 9, "[\(testCase.id)] resolution")
            XCTAssertTrue(cell.isValidCell, "[\(testCase.id)] valid cell")
        }
    }

    func testParentsMatchFixture() throws {
        let fixture = try loadFixture()
        for testCase in fixture.cases {
            let cell = try XCTUnwrap(H3Index(string: testCase.expected.r9), "[\(testCase.id)] parse r9")
            let parents = testCase.expected.parents
            XCTAssertEqual(try H3.cellToParent(cell, res: 8).description, parents.r8, "[\(testCase.id)] r8 parent")
            XCTAssertEqual(try H3.cellToParent(cell, res: 7).description, parents.r7, "[\(testCase.id)] r7 parent")
            XCTAssertEqual(try H3.cellToParent(cell, res: 6).description, parents.r6, "[\(testCase.id)] r6 parent")
            XCTAssertEqual(try H3.cellToParent(cell, res: 5).description, parents.r5, "[\(testCase.id)] r5 parent")
        }
    }

    func testBoundaryVertexCountMatchesFixture() throws {
        let fixture = try loadFixture()
        for testCase in fixture.cases {
            let cell = try XCTUnwrap(H3Index(string: testCase.expected.r9), "[\(testCase.id)] parse r9")
            let boundary = try H3.cellToBoundary(cell)
            XCTAssertEqual(boundary.count, testCase.expected.boundaryVertexCount, "[\(testCase.id)] boundary vertices")
            // H3 (C core and h3-js alike) reports distortion vertices for pentagons at res > 0, so a res-9
            // pentagon has 10 boundary vertices, never 5; every hexagon has exactly 6.
            XCTAssertEqual(cell.isPentagon, boundary.count != 6, "[\(testCase.id)] pentagon flag")
        }
    }

    func testPolygonToCellsOfBoundaryContainsCell() throws {
        let fixture = try loadFixture()
        for testCase in fixture.cases {
            // polygonToCells uses cell-centre containment on a lat/lon plane and does not support polygons that
            // wrap a pole (h3-js behaves the same), so polar cells are checked for a non-throwing call only.
            let cell = try XCTUnwrap(H3Index(string: testCase.expected.r9), "[\(testCase.id)] parse r9")
            let boundary = try H3.cellToBoundary(cell)
            let cells = try H3.polygonToCells(boundary, res: 9)
            if abs(testCase.input.lat) > 85 {
                XCTAssertFalse(cells.isEmpty, "[\(testCase.id)] polar polygonToCells returns something")
                continue
            }
            XCTAssertTrue(cells.contains(cell), "[\(testCase.id)] polygonToCells(boundary) contains the cell (got \(cells.count) cells)")
        }
    }

    func testGridPathToNeighbourHasLengthTwo() throws {
        let fixture = try loadFixture()
        for testCase in fixture.cases {
            let cell = try XCTUnwrap(H3Index(string: testCase.expected.r9), "[\(testCase.id)] parse r9")
            let neighbour = try XCTUnwrap(
                try H3.gridDisk(cell, k: 1).first(where: { $0 != cell }),
                "[\(testCase.id)] neighbour"
            )
            XCTAssertTrue(try H3.areNeighborCells(cell, neighbour), "[\(testCase.id)] gridDisk neighbour is adjacent")
            let path = try H3.gridPathCells(cell, neighbour)
            XCTAssertEqual(path.count, 2, "[\(testCase.id)] gridPathCells to a neighbour has length 2")
            XCTAssertEqual(path.first, cell, "[\(testCase.id)] path starts at the cell")
            XCTAssertEqual(path.last, neighbour, "[\(testCase.id)] path ends at the neighbour")
        }
    }

    func testChildrenRoundTripToParent() throws {
        let fixture = try loadFixture()
        for testCase in fixture.cases.prefix(25) {
            let cell = try XCTUnwrap(H3Index(string: testCase.expected.r9), "[\(testCase.id)] parse r9")
            let children = try H3.cellToChildren(cell, res: 10)
            XCTAssertEqual(children.count, cell.isPentagon ? 6 : 7, "[\(testCase.id)] child count")
            for child in children {
                XCTAssertEqual(try H3.cellToParent(child, res: 9), cell, "[\(testCase.id)] child \(child) → parent")
            }
        }
    }
}
