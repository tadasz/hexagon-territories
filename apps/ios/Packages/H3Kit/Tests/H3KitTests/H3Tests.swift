import H3Kit
import XCTest

/// Fixture-independent checks of the wrapper: known values cross-checked against `h3-js` 4.x.
final class H3Tests: XCTestCase {
    /// Kaunas (the map's initial centre, research.md R9) — `h3-js`: latLngToCell(54.8985, 23.9036, 9).
    private let kaunas = LatLng(lat: 54.8985, lon: 23.9036)
    private let kaunasCell = "891f40d1a4fffff"

    func testVersionIsTheVendoredRelease() {
        XCTAssertEqual(H3.version, "4.2.1")
    }

    func testKaunasResolution9Cell() throws {
        let cell = try H3.latLngToCell(kaunas, res: 9)
        XCTAssertEqual(cell.description, kaunasCell)
        XCTAssertEqual(try H3.cellToParent(cell, res: 7).description, "871f40d1affffff")
        XCTAssertEqual(cell.resolution, 9)
        XCTAssertFalse(cell.isPentagon)
    }

    func testStringRoundTrip() throws {
        let parsed = try XCTUnwrap(H3Index(string: kaunasCell))
        XCTAssertEqual(parsed.description, kaunasCell)
        XCTAssertEqual(H3Index(kaunasCell), parsed)
        XCTAssertTrue(parsed.isValidCell)
    }

    func testInvalidStringsAreRejected() {
        XCTAssertNil(H3Index(string: ""))
        XCTAssertNil(H3Index(string: "not-a-cell"))
        XCTAssertNil(H3Index(string: "zz1f40d1a4fffff"))
    }

    func testCodableUsesHexStrings() throws {
        let cell = try XCTUnwrap(H3Index(string: kaunasCell))
        let data = try JSONEncoder().encode([cell])
        XCTAssertEqual(String(decoding: data, as: UTF8.self), "[\"\(kaunasCell)\"]")
        XCTAssertEqual(try JSONDecoder().decode([H3Index].self, from: data), [cell])
        XCTAssertThrowsError(try JSONDecoder().decode([H3Index].self, from: Data("[\"nope\"]".utf8)))
    }

    func testCellCentreIsInsideTheCell() throws {
        let cell = try H3.latLngToCell(kaunas, res: 9)
        let centre = try H3.cellToLatLng(cell)
        XCTAssertEqual(try H3.latLngToCell(centre, res: 9), cell)
        XCTAssertEqual(centre.lat, kaunas.lat, accuracy: 0.01)
        XCTAssertEqual(centre.lon, kaunas.lon, accuracy: 0.01)
    }

    func testBoundaryHasSixVerticesForAHexagon() throws {
        let boundary = try H3.cellToBoundary(try H3.latLngToCell(kaunas, res: 9))
        XCTAssertEqual(boundary.count, 6)
        for vertex in boundary {
            XCTAssertEqual(vertex.lat, kaunas.lat, accuracy: 0.01)
            XCTAssertEqual(vertex.lon, kaunas.lon, accuracy: 0.01)
        }
    }

    func testPentagonBoundaryAndChildren() throws {
        // `h3-js`: getPentagons(9)[0]; cellToBoundary(...).length == 10 (distortion vertices at res > 0).
        let pentagon = try XCTUnwrap(H3Index(string: "89080000003ffff"))
        XCTAssertTrue(pentagon.isPentagon)
        XCTAssertEqual(try H3.cellToBoundary(pentagon).count, 10)
        XCTAssertEqual(try H3.cellToChildren(pentagon, res: 10).count, 6)
    }

    func testInvalidResolutionThrowsTypedError() {
        XCTAssertThrowsError(try H3.latLngToCell(kaunas, res: 16)) { error in
            XCTAssertEqual(error as? H3Error, .resDomain)
        }
    }

    func testInvalidCellThrowsTypedError() {
        XCTAssertFalse(H3Index(value: 0).isValidCell)
        XCTAssertThrowsError(try H3.cellToChildren(H3Index(value: 0), res: 10)) { error in
            XCTAssertEqual(error as? H3Error, .cellInvalid)
        }
    }

    func testParentCoarserThanCellIsRejected() throws {
        let cell = try H3.latLngToCell(kaunas, res: 9)
        XCTAssertThrowsError(try H3.cellToParent(cell, res: 10)) { error in
            XCTAssertEqual(error as? H3Error, .resMismatch)
        }
    }

    func testPolygonToCellsOfAViewportAroundKaunas() throws {
        let viewport = [
            LatLng(lat: 54.88, lon: 23.88),
            LatLng(lat: 54.88, lon: 23.93),
            LatLng(lat: 54.92, lon: 23.93),
            LatLng(lat: 54.92, lon: 23.88),
        ]
        let cells = try H3.polygonToCells(viewport, res: 9)
        XCTAssertGreaterThan(cells.count, 50)
        XCTAssertTrue(cells.allSatisfy { $0.resolution == 9 })
        XCTAssertEqual(Set(cells).count, cells.count, "no duplicates")
        let withHole = try H3.polygonToCells(
            viewport,
            holes: [[
                LatLng(lat: 54.89, lon: 23.89),
                LatLng(lat: 54.89, lon: 23.92),
                LatLng(lat: 54.91, lon: 23.92),
                LatLng(lat: 54.91, lon: 23.89),
            ]],
            res: 9
        )
        XCTAssertLessThan(withHole.count, cells.count, "a hole removes cells")
    }

    func testGridDiskAndPath() throws {
        let cell = try H3.latLngToCell(kaunas, res: 9)
        let disk = try H3.gridDisk(cell, k: 1)
        XCTAssertEqual(disk.count, 7)
        XCTAssertTrue(disk.contains(cell))
        let far = try H3.latLngToCell(LatLng(lat: 54.92, lon: 23.95), res: 9)
        let path = try H3.gridPathCells(cell, far)
        XCTAssertEqual(path.first, cell)
        XCTAssertEqual(path.last, far)
        XCTAssertGreaterThan(path.count, 2)
    }

    func testEdgeLength() throws {
        // `h3-js`: getHexagonEdgeLengthAvg(9, 'm') == 200.786... (H3 4.x figure; docs/territory-rules.md quotes the
        // older ~174 m value, which does not affect any rule).
        XCTAssertEqual(try H3.hexagonEdgeLengthAverageMeters(res: 9), 200.79, accuracy: 0.1)
    }
}
