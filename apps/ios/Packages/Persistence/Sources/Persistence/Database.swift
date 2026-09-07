import Core
import Foundation
import GRDB

/// Opens `nature.sqlite` (research.md R17): WAL journal, foreign keys, and the migrations applied on open.
public enum AppDatabase {
    public static let fileName = "nature.sqlite"

    /// `<Application Support>/nature.sqlite` (the directory is created on first use).
    public static func defaultURL(fileManager: FileManager = .default) throws -> URL {
        let support = try fileManager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return support.appendingPathComponent(fileName, isDirectory: false)
    }

    /// A migrated on-disk database. Throws when the file cannot be opened; callers fall back to `inMemory()` and
    /// warn the player (spec edge case "the local database fails").
    public static func open(at url: URL) throws -> DatabaseQueue {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let queue = try DatabaseQueue(path: url.path, configuration: configuration())
        try Migrations.migrator.migrate(queue)
        return queue
    }

    /// A migrated in-memory database (tests, previews, and the fallback when the file cannot be opened).
    public static func inMemory() throws -> DatabaseQueue {
        let queue = try DatabaseQueue(configuration: configuration())
        try Migrations.migrator.migrate(queue)
        return queue
    }

    static func configuration() -> Configuration {
        var configuration = Configuration()
        configuration.foreignKeysEnabled = true
        configuration.prepareDatabase { db in
            // On disk this switches to WAL; an in-memory database answers "memory" and keeps working.
            try db.execute(sql: "PRAGMA journal_mode = WAL")
        }
        return configuration
    }
}

/// Opaque handle to the walk database for callers outside this package (the app target), so nothing but
/// `Persistence` imports GRDB.
public struct WalkDatabase: Sendable {
    let queue: DatabaseQueue

    /// `<Application Support>/nature.sqlite`, migrated.
    public static func open(at url: URL) throws -> WalkDatabase {
        WalkDatabase(queue: try AppDatabase.open(at: url))
    }

    public static func openDefault() throws -> WalkDatabase {
        try open(at: try AppDatabase.defaultURL())
    }

    public static func inMemory() throws -> WalkDatabase {
        WalkDatabase(queue: try AppDatabase.inMemory())
    }
}

extension GRDBWalkRepository {
    public convenience init(database: WalkDatabase, clock: any Clock = SystemClock()) {
        self.init(db: database.queue, clock: clock)
    }
}

extension OutboxQueue {
    public convenience init(database: WalkDatabase) {
        self.init(db: database.queue)
    }
}
