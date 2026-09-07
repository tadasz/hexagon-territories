import Foundation
import GRDB

/// Schema v1 (`data-model.md` §5). Times are `REAL` seconds since 1970 (UTC); JSON columns are `TEXT`/`BLOB`.
enum Migrations {
    static let v1 = "v1-walks"

    static var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()
        migrator.registerMigration(v1) { db in
            try db.create(table: "walk") { t in
                t.primaryKey("id", .text)
                t.column("server_id", .text)
                t.column("started_at", .double).notNull()
                t.column("ended_at", .double)
                t.column("status", .text).notNull()
                t.column("finish_reason", .text)
                t.column("distance_m", .double).notNull().defaults(to: 0)
                t.column("moving_s", .integer).notNull().defaults(to: 0)
                t.column("steps", .integer)
                t.column("hex_count", .integer).notNull().defaults(to: 0)
                t.column("xp", .integer).notNull().defaults(to: 0)
                t.column("flags", .text).notNull().defaults(to: "[]")
                t.column("summary", .text)
                t.column("sync_state", .text).notNull()
                t.column("sync_error", .text)
                t.column("updated_at", .double).notNull()
            }
            try db.create(index: "walk_started_at_idx", on: "walk", columns: ["started_at"])

            try db.create(table: "location_sample") { t in
                t.column("walk_id", .text).notNull().references("walk", onDelete: .cascade)
                t.column("seq", .integer).notNull()
                t.column("ts", .double).notNull()
                t.column("lat", .double).notNull()
                t.column("lon", .double).notNull()
                t.column("h_acc", .double).notNull()
                t.column("speed", .double)
                t.column("course", .double)
                t.column("alt", .double)
                t.column("accepted", .integer).notNull()
                t.column("reject_reason", .text)
                t.column("outbox_id", .integer)
                t.primaryKey(["walk_id", "seq"])
            }
            try db.create(index: "location_sample_outbox_idx", on: "location_sample", columns: ["walk_id", "outbox_id"])

            try db.create(table: "walk_path") { t in
                t.primaryKey("walk_id", .text).references("walk", onDelete: .cascade)
                t.column("points", .blob).notNull()
                t.column("hex_estimates", .blob).notNull()
                t.column("updated_at", .double).notNull()
            }

            try db.create(table: "outbox") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("walk_id", .text).notNull()
                t.column("kind", .text).notNull()
                t.column("payload", .blob).notNull()
                t.column("attempts", .integer).notNull().defaults(to: 0)
                t.column("next_attempt_at", .double).notNull()
                t.column("last_error", .text)
                t.column("created_at", .double).notNull()
            }
            try db.create(index: "outbox_next_attempt_idx", on: "outbox", columns: ["next_attempt_at", "id"])
            try db.create(index: "outbox_walk_idx", on: "outbox", columns: ["walk_id", "id"])
        }
        return migrator
    }
}
