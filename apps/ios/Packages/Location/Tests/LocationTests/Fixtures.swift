import Foundation
import Location
import TerritoryRules
import XCTest

/// Finds `packages/h3-fixtures/fixtures/walk-paths.json` by walking up from this file to the directory containing
/// `pnpm-workspace.yaml` (the same walk-up as `TerritoryRulesTests/Fixtures.swift`); `NATURE_FIXTURES_DIR` overrides.
enum FixtureLocator {
    enum Failure: Error, CustomStringConvertible {
        case repositoryRootNotFound(startedAt: String)
        case fixtureMissing(path: String)

        var description: String {
            switch self {
            case let .repositoryRootNotFound(startedAt): "could not find pnpm-workspace.yaml above \(startedAt)"
            case let .fixtureMissing(path): "fixture file missing: \(path)"
            }
        }
    }

    static func fixturesDirectory(from file: String = #filePath) throws -> URL {
        if let override = ProcessInfo.processInfo.environment["NATURE_FIXTURES_DIR"], !override.isEmpty {
            return URL(fileURLWithPath: override, isDirectory: true)
        }
        var directory = URL(fileURLWithPath: file).deletingLastPathComponent()
        while true {
            if FileManager.default.fileExists(atPath: directory.appendingPathComponent("pnpm-workspace.yaml").path) {
                return directory.appendingPathComponent("packages/h3-fixtures/fixtures", isDirectory: true)
            }
            let parent = directory.deletingLastPathComponent()
            if parent.path == directory.path { throw Failure.repositoryRootNotFound(startedAt: file) }
            directory = parent
        }
    }

    static func load<T: Decodable>(_ type: T.Type, named name: String) throws -> T {
        let url = try fixturesDirectory().appendingPathComponent("\(name).json")
        guard FileManager.default.fileExists(atPath: url.path) else { throw Failure.fixtureMissing(path: url.path) }
        return try JSONDecoder().decode(type, from: Data(contentsOf: url))
    }
}

/// `walk-paths.json` (packages/h3-fixtures README "walk-paths").
struct WalkPathsFixture: Decodable {
    struct Input: Decodable {
        let resolution: Int
        let simplifyToleranceM: Double
        let pedometerSteps: Int?
        let samples: [Sample]
    }

    struct Rejected: Decodable {
        let seq: Int
        let reason: String
    }

    struct HexMetersExpectation: Decodable {
        let cell: String
        let meters: Double
    }

    struct Expected: Decodable {
        let acceptedSeqs: [Int]
        let rejected: [Rejected]
        let flags: [String]
        let distanceM: Double
        let simplifiedPointCount: Int
        let hexMeters: [HexMetersExpectation]
    }

    struct Case: Decodable {
        let id: String
        let input: Input
        let expected: Expected
    }

    let name: String
    let cases: [Case]

    static func load() throws -> WalkPathsFixture {
        let fixture = try FixtureLocator.load(WalkPathsFixture.self, named: "walk-paths")
        XCTAssertEqual(fixture.name, "walk-paths")
        XCTAssertEqual(fixture.cases.count, 6, "the six walk-path cases")
        return fixture
    }

    func caseNamed(_ id: String) throws -> Case {
        try XCTUnwrap(cases.first { $0.id == id }, "fixture case \(id)")
    }
}

extension Sample {
    /// A fixture sample as the device would see it (no throttle decision yet).
    var fix: LocationFix {
        LocationFix(timestamp: ts, lat: lat, lon: lon, hAcc: hAcc, speed: speed, course: course, alt: alt)
    }
}


