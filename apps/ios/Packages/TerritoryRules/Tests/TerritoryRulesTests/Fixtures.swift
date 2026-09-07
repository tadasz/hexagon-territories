import TerritoryRules
import Foundation
import XCTest

/// Finds the shared JSON fixtures in `packages/h3-fixtures/fixtures/` by walking up from this source file
/// until the directory containing `pnpm-workspace.yaml` (the repository root) is found — research.md R3.
/// `NATURE_FIXTURES_DIR` overrides the directory (used for temporary local copies before Stream A lands).
enum FixtureLocator {
    enum Failure: Error, CustomStringConvertible {
        case repositoryRootNotFound(startedAt: String)
        case fixtureMissing(path: String)
        case decoding(file: String, path: String, message: String)
        case unreadable(file: String, underlying: String)

        var description: String {
            switch self {
            case let .repositoryRootNotFound(startedAt):
                "could not find a directory containing pnpm-workspace.yaml above \(startedAt)"
            case let .fixtureMissing(path):
                "fixture file missing: \(path)"
            case let .decoding(file, path, message):
                "\(file): \(path): \(message)"
            case let .unreadable(file, underlying):
                "\(file): \(underlying)"
            }
        }
    }

    static let rootMarker = "pnpm-workspace.yaml"
    static let fixturesRelativePath = "packages/h3-fixtures/fixtures"
    static let overrideEnvironmentKey = "NATURE_FIXTURES_DIR"

    /// The repository root (directory containing `pnpm-workspace.yaml`), found by walking up from `file`.
    static func repositoryRoot(from file: String = #filePath) throws -> URL {
        var directory = URL(fileURLWithPath: file).deletingLastPathComponent()
        while true {
            let marker = directory.appendingPathComponent(rootMarker)
            if FileManager.default.fileExists(atPath: marker.path) {
                return directory
            }
            let parent = directory.deletingLastPathComponent()
            if parent.path == directory.path {
                throw Failure.repositoryRootNotFound(startedAt: file)
            }
            directory = parent
        }
    }

    /// The fixtures directory: `NATURE_FIXTURES_DIR` if set, otherwise `<root>/packages/h3-fixtures/fixtures`.
    static func fixturesDirectory() throws -> URL {
        if let override = ProcessInfo.processInfo.environment[overrideEnvironmentKey], !override.isEmpty {
            return URL(fileURLWithPath: override, isDirectory: true)
        }
        return try repositoryRoot().appendingPathComponent(fixturesRelativePath, isDirectory: true)
    }

    /// URL of `<name>.json`; throws `fixtureMissing` naming the full path when the file does not exist.
    static func url(forFixtureNamed name: String) throws -> URL {
        let url = try fixturesDirectory().appendingPathComponent("\(name).json")
        guard FileManager.default.fileExists(atPath: url.path) else {
            throw Failure.fixtureMissing(path: url.path)
        }
        return url
    }

    /// Loads and decodes a fixture, mapping `DecodingError` to `Failure.decoding(file:path:message:)`.
    static func load<T: Decodable>(_ type: T.Type, named name: String) throws -> T {
        let url = try url(forFixtureNamed: name)
        return try decode(type, from: url)
    }

    static func decode<T: Decodable>(_ type: T.Type, from url: URL) throws -> T {
        let data: Data
        do {
            data = try Data(contentsOf: url)
        } catch {
            throw Failure.unreadable(file: url.lastPathComponent, underlying: "\(error)")
        }
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch let error as DecodingError {
            throw Failure.decoding(
                file: url.lastPathComponent,
                path: codingPath(of: error),
                message: message(of: error)
            )
        } catch {
            throw Failure.decoding(file: url.lastPathComponent, path: "$", message: "\(error)")
        }
    }

    private static func codingPath(of error: DecodingError) -> String {
        let path: [CodingKey]
        switch error {
        case let .typeMismatch(_, context), let .valueNotFound(_, context), let .dataCorrupted(context):
            path = context.codingPath
        case let .keyNotFound(key, context):
            path = context.codingPath + [key]
        @unknown default:
            path = []
        }
        let rendered = path.map { key -> String in
            if let index = key.intValue { return "[\(index)]" }
            return ".\(key.stringValue)"
        }.joined()
        return "$" + rendered
    }

    private static func message(of error: DecodingError) -> String {
        switch error {
        case let .typeMismatch(type, context): "expected \(type): \(context.debugDescription)"
        case let .valueNotFound(type, context): "missing value of type \(type): \(context.debugDescription)"
        case let .keyNotFound(key, context): "missing key \(key.stringValue): \(context.debugDescription)"
        case let .dataCorrupted(context): "data corrupted: \(context.debugDescription)"
        @unknown default: "\(error)"
        }
    }
}

// MARK: - Codable mirrors of packages/h3-fixtures/fixtures/*.json (data-model.md §1)

/// Fixture envelope fields shared by every file (data-model.md §1.1).
protocol FixtureEnvelope: Decodable {
    var name: String { get }
    var description: String { get }
    var generator: String { get }
    var version: Int { get }
}

struct Coordinate: Decodable {
    let lat: Double
    let lon: Double
}

/// `latlng-to-cell.json` (§1.2)
struct LatLngToCellFixture: FixtureEnvelope {
    struct Parents: Decodable {
        let r8: String
        let r7: String
        let r6: String
        let r5: String
    }

    struct Expected: Decodable {
        let r9: String
        let parents: Parents
        let boundaryVertexCount: Int
    }

    struct Case: Decodable {
        let id: String
        let input: Coordinate
        let expected: Expected
    }

    let name: String
    let description: String
    let generator: String
    let version: Int
    let seed: Int?
    let cases: [Case]
}

/// `zoom-resolution.json` (§1.3)
struct ZoomResolutionFixture: FixtureEnvelope {
    struct Input: Decodable {
        let zoom: Double
    }

    struct Expected: Decodable {
        let resolution: Int
    }

    struct Case: Decodable {
        let id: String
        let input: Input
        let expected: Expected
    }

    let name: String
    let description: String
    let generator: String
    let version: Int
    let seed: Int?
    let cases: [Case]
}

/// `walk-paths.json` (§1.4)
struct WalkPathsFixture: FixtureEnvelope {
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
        let description: String?
        let input: Input
        let expected: Expected
    }

    let name: String
    let description: String
    let generator: String
    let version: Int
    let seed: Int?
    let cases: [Case]
}

/// `reckoning-weeks.json` (§1.5)
struct ReckoningWeeksFixture: FixtureEnvelope {
    struct Strength: Decodable {
        let factionId: Int
        let strength: Double
    }

    struct State: Decodable {
        let owner: Int?
        let strengths: [Strength]
    }

    struct ContributionInput: Decodable {
        let factionId: Int
        let userId: String
        let meters: Double
    }

    struct Capped: Decodable {
        let factionId: Int
        let userId: String
        let cappedMeters: Double
    }

    struct Event: Decodable {
        let from: Int?
        let to: Int?
    }

    struct WeekExpected: Decodable {
        let capped: [Capped]
        let strengths: [Strength]
        let owner: Int?
        let flipped: Bool
        let event: Event?
    }

    struct Week: Decodable {
        let weekId: String
        let contributions: [ContributionInput]
        let bonuses: [ContributionInput]
        let expected: WeekExpected
    }

    struct CellCase: Decodable {
        let id: String
        let cell: String
        let initial: State
        let weeks: [Week]
    }

    struct ParentInput: Decodable {
        let childOwners: [Int?]
    }

    struct ParentExpected: Decodable {
        let owner: Int?
    }

    struct ParentCase: Decodable {
        let id: String
        let input: ParentInput
        let expected: ParentExpected
    }

    let name: String
    let description: String
    let generator: String
    let version: Int
    let seed: Int?
    let factions: [Int]
    let weeks: [String]
    let cells: [CellCase]
    let parentCases: [ParentCase]
}

// MARK: - XCTest helpers

extension XCTestCase {
    /// Loads a fixture; on failure records an `XCTFail` naming the file (and the JSON path for schema problems)
    /// and rethrows so the test stops.
    func loadFixture<T: FixtureEnvelope>(_ type: T.Type, named name: String, file: StaticString = #filePath, line: UInt = #line) throws -> T {
        do {
            let fixture = try FixtureLocator.load(type, named: name)
            XCTAssertEqual(fixture.name, name, "fixture envelope name", file: file, line: line)
            return fixture
        } catch {
            XCTFail("\(name).json could not be loaded: \(error)", file: file, line: line)
            throw error
        }
    }
}
