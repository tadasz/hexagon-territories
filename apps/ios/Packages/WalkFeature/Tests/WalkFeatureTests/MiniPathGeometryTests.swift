import Foundation
import H3Kit
@testable import WalkFeature
import XCTest

final class MiniPathGeometryTests: XCTestCase {
    func testBoundingBoxFillsTheFrameAndKeepsAspect() {
        // 200 m east-west, 100 m north-south at 54.9° N.
        let dLon = 200 / (111_195 * cos(54.9 * .pi / 180))
        let dLat = 100 / 111_195.0
        let path = [
            LatLng(lat: 54.9, lon: 23.9),
            LatLng(lat: 54.9 + dLat, lon: 23.9 + dLon),
        ]
        let points = MiniPathGeometry.normalize(path, width: 100, height: 100, padding: 0)
        XCTAssertEqual(points.count, 2)
        XCTAssertEqual(points[0].x, 0, accuracy: 0.01)
        XCTAssertEqual(points[1].x, 100, accuracy: 0.01, "the longer side fills the frame")
        XCTAssertEqual(points[1].y - points[0].y, -50, accuracy: 0.5, "half as tall, north is up")
        XCTAssertEqual((points[0].y + points[1].y) / 2, 50, accuracy: 0.5, "centred vertically")
    }

    func testPaddingAndNonSquareFrame() {
        let path = [LatLng(lat: 54.9, lon: 23.9), LatLng(lat: 54.901, lon: 23.9)]
        let points = MiniPathGeometry.normalize(path, width: 60, height: 40, padding: 4)
        XCTAssertEqual(points[0].y, 36, accuracy: 0.01, "south end at the bottom padding")
        XCTAssertEqual(points[1].y, 4, accuracy: 0.01, "north end at the top padding")
        XCTAssertEqual(points[0].x, 30, accuracy: 0.01, "vertical line centred")
        XCTAssertEqual(points[1].x, 30, accuracy: 0.01)
    }

    func testDegenerateAndEmptyPaths() {
        XCTAssertEqual(MiniPathGeometry.normalize([], width: 50, height: 50), [])
        let single = MiniPathGeometry.normalize([LatLng(lat: 54.9, lon: 23.9)], width: 50, height: 50)
        XCTAssertEqual(single, [MiniPathGeometry.Point(x: 25, y: 25)])
        let same = MiniPathGeometry.normalize([LatLng(lat: 54.9, lon: 23.9), LatLng(lat: 54.9, lon: 23.9)], width: 50, height: 50)
        XCTAssertEqual(same, [MiniPathGeometry.Point(x: 25, y: 25), MiniPathGeometry.Point(x: 25, y: 25)])
        XCTAssertEqual(MiniPathGeometry.normalize([LatLng(lat: 54.9, lon: 23.9)], width: 0, height: 10), [])
    }
}
