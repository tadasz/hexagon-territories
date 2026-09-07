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

/// `Codable` mirror of `packages/h3-fixtures/fixtures/latlng-to-cell.json` (data-model.md §1.2).
struct LatLngToCellFixture: Decodable {
    struct Coordinate: Decodable {
        let lat: Double
        let lon: Double
    }

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
