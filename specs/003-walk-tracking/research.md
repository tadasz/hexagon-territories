# Research: Walk Tracking

**Feature**: `003-walk-tracking` | **Date**: 2026-09-07

Phase 0 of `plan.md`. Every "NEEDS CLARIFICATION" of the Technical Context and every design choice that is not already fixed by `docs/architecture.md`, `docs/territory-rules.md` or the feature's binding decisions is resolved here as a numbered decision (R1–R20) with rationale and rejected alternatives. Later documents reference these numbers.

## R1. `finishWalk` is a pure function over stored rows, called from three places

**Decision**: `apps/api/src/modules/walks/finish.ts` exports `finishWalk(tx, { walkId, endedAt, reason })` running inside a caller-supplied transaction with `SELECT … FROM walk_sessions WHERE id = $1 FOR UPDATE`. It is invoked by `POST /v1/walks/{id}/finish` (`reason = 'client'`), by the `walk.autofinish` job (`'autofinish'`), and by `POST /v1/walks` when it supersedes a stale active walk (`'superseded'`). If the row is no longer `active` it returns the stored summary (`research R7` idempotency). Pipeline exactly as `packages/territory-rules/README.md` "finishWalk pipeline": `acceptSamples` → `walkFlags(accepted, steps)` → `simplifyPath` → `pathLengthM` → `pathToHexMeters` → `weekIdFor(endedAt)` → `applyWeeklyCap` over (existing contribution rows + this walk).

**Rationale**: Constitution I/II ("metres are scored only in `finishWalk`"); one function keeps the three entry points identical and lets the integration tests call the service directly for the race cases.

**Alternatives rejected**: scoring on ingest (violates I); a separate autofinish scorer (drift).

## R2. Samples endpoint stores first, evaluates provisionally

**Decision**: `POST /v1/walks/{id}/samples` runs in one transaction: lock the walk row (`FOR UPDATE`, serialising batches per walk), reject if not `active`, load the set of already stored `seq`s in the batch's `[minSeq, maxSeq]` range, insert the missing rows with `ON CONFLICT (walk_id, seq, ts) DO NOTHING`, then run `acceptSamples` over *the batch's new rows together with the last accepted stored sample* (highest `ts` with `accepted = true`) to fill `accepted`/`reject_reason` provisionally, bump `sample_count`, and answer `{ stored, duplicates, accepted, rejected }`. `finishWalk` re-runs the filter over all rows in `seq` order and overwrites the two columns, deduplicating any same-`seq` rows by keeping the lowest `ts`.

**Rationale**: The partition key forces `ts` into the primary key, so `(walk_id, seq)` uniqueness must be enforced in the application (data-model.md §1.2); a provisional evaluation gives the app immediate feedback without pretending to be final.

**Alternatives rejected**: a global unique index on `(walk_id, seq)` (impossible on a partitioned table without the partition key); re-running the filter over every stored sample on each batch (O(n²) per walk).

## R3. Idempotent creation, overlap guard and supersede

**Decision**: `POST /v1/walks` upserts on `(user_id, client_walk_id)`: existing row → `200` with the same `walkId`; new → `201`. Before inserting, the player's `active` walk (partial index `walk_sessions_active_user_idx`) is loaded: if `newStartedAt > lastActivityAt(activeWalk)` (last accepted sample `ts`, else `started_at`) the active walk is finished with `reason = 'superseded'` in the same transaction; otherwise `409 WALK_OVERLAP { activeWalkId }`. `startedAt` is clamped to `[now − 12 h, now + 5 min]`. The walk row stores `faction_id` from the user at creation; `finishWalk` re-reads the user's current faction and credits that one (spec edge case).

**Rationale**: Offline outboxes are FIFO, so a genuine overlap means a bug or a second device; a stale active walk (phone died) must not block the player for 12 hours.

**Alternatives rejected**: `409` always (blocks players after a crash); silently abandoning the old walk (loses metres the player earned).

## R4. End-time clamp and week id

**Decision**: `endedAt' = clamp(clientEndedAt, lastAcceptedSampleTs ?? startedAt, serverNow)`; `week_id = weekIdFor(endedAt')`; `duration_s = endedAt' − started_at` (wall time, server-side; the app shows *moving* time locally, computed from its pause detector, and the summary shows the server's duration).

**Rationale**: The client cannot pre- or post-date a walk across the Monday cutoff; a walk without samples still gets a sane end.

**Alternatives rejected**: `week_id` from `started_at` (contradicts `docs/territory-rules.md`); trusting `endedAt` (Constitution I).

## R5. Weekly cap application inside the transaction

**Decision**: For each cell of the walk, `SELECT … FROM hex_week_contribution WHERE (h3_r9, week_id, faction_id, user_id) = … FOR UPDATE`; new `meters = old.meters + walkMeters`; `capped_meters = min(new meters, 2000)` via `applyWeeklyCap([{cell, factionId, userId, meters: newMeters}])`; `walks += 1`; `updated_at = now`. The summary's `cappedMeters` for that cell is `new.capped_meters − old.capped_meters`. H3 cells are converted with `BigInt('0x' + cell)` for the `bigint` columns and back with `.toString(16)` (15 lowercase hex chars, matching the fixtures).

**Rationale**: Reuses the rules function so the cap has one implementation; locking per cell keeps two concurrent finishes of the same player consistent.

## R6. XP: `walk_distance` ledger row and a daily cap

**Decision**: `xp = floor(distanceM / 100)` from the simplified accepted path; capped so that the player's `walk_distance` XP for the current UTC day (sum of `points_ledger` rows with `kind = 'walk_distance'` and `created_at >= date_trunc('day', now() at time zone 'UTC')`) does not exceed `WALK_XP_DAILY_CAP = 300`. One ledger row per scored walk (`ref_type = 'walk'`, `ref_id = walkId`, `week_id`, `h3_r9 = null`), `users.xp += points`. Level recomputation is feature 008's concern; `users.level` is left untouched. The constant lives in `apps/api/src/modules/walks/limits.ts` (with the ingest limits), not in `packages/territory-rules`, for the same reason 002 kept account rules out of the territory constants: it is an abuse limit the client never evaluates. `docs/architecture.md` §5 already lists the "daily walking-XP cap"; Stream C writes the number next to it.

**Alternatives rejected**: adding `XP_PER_100M` to the rules package (already in `docs/territory-rules.md` "Scoring at walk finish" step 4 as text; no fixture consumes it — keep it in `limits.ts` with a doc-consistency test like 002's `factions-rules.test.ts`).

## R7. Flagged walks

**Decision**: `walkFlags` non-empty → `status = 'flagged'`, `flags` stored on the row, one `anti_cheat_flags` row per flag (`code = flag`, `details = { distanceM, durationS, medianSpeed, steps }`), `walk_hex_meters` written (the player sees the path), **no** `hex_week_contribution` upsert, **no** XP. Summary carries `flags`, `scored: false`, `cappedMeters = 0` and `weekStanding` still filled from the current read model. Re-scoring after an admin clears a flag is feature 008 (it will call `finishWalk`'s scoring half again); 003 leaves `resolved_at` null.

**Rationale**: `docs/territory-rules.md` "Flagged walks are stored but excluded from the reckoning"; exclusion is simplest when nothing is written to the reckoning's input.

## R8. Week standing read model

**Decision**: `weekStanding(cell, weekId, myFactionId)` in `modules/walks/standing.ts`: score per faction = `hex_faction_strength.strength × 0.5` (rows for the cell; 0 when none) `+ Σ hex_week_contribution.capped_meters + Σ capture_bonus_m` for `(cell, weekId)` grouped by faction. `leader` = faction with the highest score (ties → lowest `faction_id`; `null` when every score is 0); `myFactionShare` = my faction's score / Σ scores (0 when Σ = 0), rounded to 3 decimals. Computed after the upsert so the walk's own metres are included. `hex_state.owner_faction_id` is read for `owner` but never written.

**Rationale**: Matches the `pressureLeader` definition ("Between reckonings") so 004/005 reuse the same query; capture bonuses are 0 until 006 without changing the formula.

## R9. Autofinish and samples purge jobs

**Decision**: `walk.autofinish`: pg-boss cron `0 * * * *` (hourly), singleton; selects `walk_sessions WHERE status = 'active' AND started_at < now() − 12 h` (new partial index on `(started_at) WHERE status = 'active'`), calls `finishWalk` per walk in its own transaction with `endedAt = lastAcceptedSampleTs ?? started_at`, `reason = 'autofinish'`; returns `{ finished, failed }`. `samples.purge`: daily `30 3 * * *`, drops every `location_samples_yYYYYmMM` partition whose upper bound is older than 30 days (`DROP TABLE` of the partition, after `DETACH` for safety) and calls `ensure_location_samples_partition` for next month; returns `{ dropped: [names], ensured }`. Both are registered through 002's `registerJobs` registry and runnable via `src/jobs/run.ts` (`job:autofinish`, `job:purge-samples`).

**Rationale**: Architecture §5 job list; `0001_partitions.sql` says "the purge job (feature 003) calls it forward". Dropping partitions is O(1) versus deleting rows.

## R10. Ingest limits

**Decision**: `@fastify/rate-limit` per route (002's `rate-limit` plugin, `global: false`) keyed by `request.user.id`: `POST /v1/walks/{id}/samples` `max: 30, timeWindow: '15 minutes'` (2/min average, burst 30 for outbox drains) → `429 RATE_LIMITED { retryAfterS }`; `POST /v1/walks` `max: 20 per hour`. Daily quota: inside the samples transaction, `SUM(sample_count)` over the player's walks with `started_at >= today UTC` + batch size > `SAMPLES_PER_DAY = 8640` → `429 SAMPLE_QUOTA_EXCEEDED { retryAfterS = seconds to next UTC midnight }`. Constants in `modules/walks/limits.ts`. Simulator/tester roles are not special-cased in 003 (App Attest is 008).

**Alternatives rejected**: a true token bucket (needs a store; 002 already accepted in-memory fixed windows on one instance).

## R11. Paths in PostGIS and in the API

**Decision**: `path` = accepted raw samples as `geography(LineString,4326)` (via `ST_MakeLine(ARRAY[ST_MakePoint(lon,lat)…])::geography`, only when ≥ 2 accepted samples), `path_simplified` = the rules package's Douglas–Peucker output (not `ST_Simplify`, so the stored path is exactly what was scored). The API returns paths as GeoJSON `LineString` (`{ type, coordinates: [[lon, lat], …] }`) read back with `ST_AsGeoJSON(path_simplified)`. The list endpoint carries no path (the app has its own local path for previews; the detail endpoint has it).

**Rationale**: GeoJSON is what MapLibre consumes in 005; one geometry stored once.

## R12. Cursor pagination

**Decision**: `GET /v1/walks?cursor=&limit=` (`limit` 1–50, default 20); rows ordered by `(started_at DESC, id DESC)`; the cursor is base64url of `${startedAt.toISOString()}|${id}` of the last returned row; response `{ items, nextCursor }` (`null` when exhausted). Malformed cursor → `400 VALIDATION_FAILED { field: 'cursor' }`.

## R13. Purge and export registration

**Decision**: `modules/walks/purge.ts` registers one step `walks` with 002's purge registry that deletes, for the user, in order: `points_ledger`, `anti_cheat_flags`, `hex_week_contribution`, `walk_sessions` (cascading `location_samples` and `walk_hex_meters`). `hex_state.captain_user_id` is `ON DELETE SET NULL` already. `modules/walks/export-section.ts` registers `walks` (walk summaries with simplified path GeoJSON and per-hex metres) and `points` (ledger rows). The 002 FK-coverage test then passes for the four tables with a `users` FK.

**Rationale**: Constitution IV; strengths already folded into `hex_faction_strength` are aggregates without a player key and stay.

## R14. `@nature/walk-sim` shape

**Decision**: `packages/walk-sim` with `bin: { "walk-sim": "dist/cli.js" }`, deps `@nature/territory-rules`, `fast-xml-parser` (MIT, GPX parsing), `commander` (MIT). Library API (`src/index.ts`): `parseTrack(text, format)` → `Track { points: [{lat, lon, ts?, ele?}] }`; `simulate(track, opts)` → `{ samples: Sample[], pedometerSteps: number | null }` with options `speedMps` (resample at constant pace when set or when the track has no timestamps; default 1.4), `jitterM` (seeded Gaussian, σ), `accuracyM` (reported `hAcc`, default 8), `teleport` (one 400 m jump inserted mid-track), `spoofNoSteps` (`pedometerSteps = 0`), `seed`; `expected(samples, steps)` → `{ acceptedSeqs, rejected, flags, distanceM, hexes: [{cell, meters}] }` using the rules package (the oracle); `replay(client, samples, opts)` → drives `POST /v1/walks`, batches (`batchSize` ≤ 200), `finish`, honouring `rate` (0 = as fast as possible, 1 = real time, N = N× faster; batches are sent when the simulated clock passes each 60 s window) and `429 retry-after`. CLI: `walk-sim replay <file> --base-url --token [--speed --jitter --accuracy --teleport --spoof-no-steps --no-finish --rate --batch-size --seed --json]`, `walk-sim dry-run <file> [same distortion flags] --json`, `walk-sim samples:generate` (writes `samples/*.gpx`). The API integration tests import `simulate`/`expected` directly (no subprocess) and drive the routes with `app.inject`. `--reckon` is 004.

**Rationale**: Architecture §3 lists `walk-sim` as "GPX → batched ingest replay CLI"; a library + thin CLI lets the same code be the test oracle.

## R15. Sample tracks around Kaunas

**Decision**: `packages/walk-sim/scripts/generate-samples.ts` (mulberry32, seed `20260907`, like the fixtures generator) writes three GPX 1.1 files with `<time>` elements: `azuolynas-loop.gpx` (~2.6 km loop inside Ąžuolynas park around 54.9035 N, 23.9320 E, 1.35 m/s, ±2 m jitter, ~35 min), `laisves-aleja-straight.gpx` (~1.7 km straight walk along Laisvės alėja from 54.8964 N, 23.9040 E to 54.8976 N, 23.9290 E, 1.4 m/s), `car-a1.gpx` (~6 km along Savanorių prospektas / A1 direction from 54.9050 N, 23.9400 E to 54.9300 N, 24.0100 E at 20 m/s, `speed` omitted, 60 steps). Coordinates are approximate street geometry, chosen so the loop stays in ≥ 4 res-9 cells, the straight walk crosses ≥ 5 cells, and the car track flags `teleport`, `speed` and `no_steps` (with `--spoof-no-steps` implied by its 60 steps) — the generator asserts these properties with the oracle before writing. Byte-identical regeneration is asserted by a test.

## R16. iOS `Location` package design (Linux-testable core)

**Decision**: Package `Location` (deps `H3Kit`, `TerritoryRules`, `Core`; platforms iOS 17 / macOS 14; builds on Linux). Pure targets: `LocationFix` (struct: `timestamp`, `lat`, `lon`, `hAcc`, `speed?`, `course?`, `alt?`, `isStationary`), protocol `LocationSource { func updates() -> AsyncStream<LocationFix>; func start() throws; func stop() }`, protocol `PedometerSource { func steps(since:) async -> Int? }`, `PathRecorder` (throttle: keep a fix when ≥ 5 s since the last kept **or** ≥ 10 m moved; apply `acceptSamples` incrementally by keeping the last accepted sample and evaluating `[last, new]`; assign `seq`; emit `RecordedSample { sample: Sample, accepted: Bool, reason: RejectReason? }`), `HexMetersEstimator` (on each accepted sample: `pathToHexMeters([prev, cur])` summed into `[H3Index: Double]`, `currentCell = latLngToCell(res 9)`, `distanceM += haversine`), `AutoPauseDetector` (paused when no accepted sample moved ≥ 10 m for 180 s or the source reports `isStationary` for 180 s; resumes on the first accepted sample ≥ 10 m away), `LivePath` (`@Observable` final class, `@MainActor`: `points: [LatLng]`, `hexEstimates`, `currentCell`, `distanceM`, `movingSeconds`, `isPaused` — the model 005's `WalkPathsLayer` observes), and the `WalkTracker` actor: states `idle → starting → recording ⇄ paused → finishing → finished(WalkFinishInput)` plus `failed(reason)`; inputs `start(clock:)`, `stop()`, fixes from the source, `tick` from an injectable `Clock`; enforces the 6 h auto-end and hands every recorded sample to a `WalkStore` protocol (implemented by `Persistence`). Platform target (`#if canImport(CoreLocation)`): `CoreLocationSource` using `CLLocationUpdate.liveUpdates(.fitness)` mapped to `LocationFix` (`update.isStationary`), `CLBackgroundActivitySession` held for the walk's lifetime, authorisation check (`CLLocationManager().authorizationStatus` must be `.authorizedWhenInUse`; never request Always), `PedometerBridge` over `CMPedometer.queryPedometerData(from:to:)` (deps `CoreMotion`). Both platform types are excluded from Linux builds by the `#if`.

**Rationale**: Architecture §4 "Walk tracking" steps 1–3 and 6; FR-020 requires Linux tests; iOS 17's async `liveUpdates` avoids delegate plumbing and gives `isStationary` for free.

**Alternatives rejected**: `CLLocationManager` delegate + `allowsBackgroundLocationUpdates` (works, but `CLBackgroundActivitySession` is the iOS 17 way to keep When-In-Use alive in the background and shows the indicator); `significantLocationChange` (too coarse).

## R17. iOS `Persistence` package (GRDB on Linux)

**Decision**: Package `Persistence` (deps `GRDB.swift` `from: "7.0.0"` via SPM, `Core`, `Location` for the store protocols). Schema v1 migration (`DatabaseMigrator`): `walk(id TEXT PK — the client walk id, server_id TEXT, started_at REAL, ended_at REAL, status TEXT, finish_reason TEXT, distance_m REAL, moving_s INTEGER, steps INTEGER, hex_count INTEGER, xp INTEGER, flags TEXT JSON, summary TEXT JSON, sync_state TEXT: pending|syncing|synced|failed, sync_error TEXT, updated_at REAL)`, `location_sample(walk_id TEXT, seq INTEGER, ts REAL, lat, lon, h_acc, speed, course, alt, accepted INTEGER, reject_reason TEXT, batch_id INTEGER NULL, PRIMARY KEY (walk_id, seq))`, `walk_path(walk_id TEXT PK, points BLOB — JSON [[lat,lon]…], hex_estimates BLOB JSON, updated_at REAL)`, `outbox(id INTEGER PK AUTOINCREMENT, walk_id TEXT, kind TEXT: create|samples|finish, payload BLOB JSON, attempts INTEGER, next_attempt_at REAL, last_error TEXT, created_at REAL)` with index `(next_attempt_at, id)`. `WalkRepository` (GRDB `DatabaseQueue`/`DatabasePool` behind a protocol) implements `Location.WalkStore` and the history queries; `OutboxQueue` enqueues `create` at start, a `samples` item every 60 s (or 200 samples) with the uncovered sample seqs, and `finish` at stop. `SyncCoordinator` actor: `drain()` processes items FIFO per `walk_id` (a walk's items in `id` order, walks interleaved by `id`), sends via `Core.WalksService`, deletes on success, on retryable failure (network, 5xx, 429 with `retry-after`, 408) sets `next_attempt_at = now + min(300, 2^attempts) ± 20 %`, on permanent failure (4xx other than 429; `WALK_OVERLAP`, `WALK_NOT_ACTIVE`, `WALK_NOT_FOUND`, `FACTION_REQUIRED`) marks the walk `failed` with the code and deletes the walk's remaining items; `finish` success stores the summary and marks `synced`; kicks: explicit `drain()`, 60 s timer while a walk records, `NWPathMonitor` satisfied (app target), `BGAppRefreshTask` (app target, identifier `com.natureexplorer.app.sync`). Raw samples of `synced` walks older than 7 days are deleted by `vacuum()` on launch. On Linux: `swift test` needs `libsqlite3-dev` (`/usr/include/sqlite3.h` is present in the agent container); GRDB's SPM manifest supports Linux (it vendors no SQLite; it links the system library). `quickstart.md` has the check.

**Alternatives rejected**: SwiftData (no background bulk writes, no Linux tests); Core Data (same).

## R18. iOS `WalkFeature` and app wiring

**Decision**: Package `WalkFeature` (deps `Core`, `DesignSystem`, `Location`, `Persistence`; SwiftUI, iOS only): `WalkViewModel` (`@Observable @MainActor`; drives `WalkTracker`, exposes HUD state from `LivePath`, `start()`, `stop()`, permission state, provisional summary from the estimator when offline, server summary when `synced`), `WalkScreen` (Start/Stop button, HUD: moving time, distance, current hex short id, "≈ N m in this hex (estimate)", hex count, paused badge, waiting-for-GPS state), `FinishSummarySheet` (distance, duration, XP, flags banner, per-hex rows: metres / counted / leader emoji + my share; "pending upload" variant), `WalkHistoryList` (paged with `nextCursor`, merges local pending walks on top, rows with `MiniPathView`), `MiniPathView` (`Canvas` polyline normalised into the row's frame; no map), `WalkDetailView`. `AppContainer` gains `walksService` (from `APIClient`), `walkRepository`, `syncCoordinator`, `walkTracker` (with `CoreLocationSource`/`PedometerBridge`; `FakeLocationSource` in previews and tests); `RootView` puts `WalkScreen` on the Walk tab. `Info.plist`: `UIBackgroundModes = [location]`, `NSLocationWhenInUseUsageDescription`, `NSMotionUsageDescription`, `BGTaskSchedulerPermittedIdentifiers = [com.natureexplorer.app.sync]`; `project.yml`: packages `Location`, `Persistence`, `WalkFeature`, the Background Modes capability (`com.apple.developer.background-modes` is not an entitlement; XcodeGen sets `UIBackgroundModes` via the plist). Audio background mode arrives with 006.

## R19. Live estimate versus server result

**Decision**: The device estimate runs over raw accepted samples; the server simplifies first. Tests therefore compare the estimator with `pathToHexMeters(rawAccepted)` computed in one call (±0.5 m — incremental equals batch) and, for the fixtures whose simplified path equals the raw one (`straight-line`, `teleport`, `car-speed`: `simplifiedPointCount = 2`), with the fixture's `hexMeters` (±0.5 m). The HUD copy says "estimate"; the summary sheet replaces every number. The `PathRecorder` filter parity test asserts `acceptedSeqs`/`rejected` exactly for all six fixture cases.

## R20. Environment facts for implementers

- API stream: Node 22 + pnpm; local Postgres 16 + PostGIS at `DATABASE_URL=postgres://nature:nature@localhost:5432/nature`; no Docker (Testcontainers unavailable — set `DATABASE_URL`); no MinIO (export section test uses 002's `MemoryObjectStorage`).
- iOS stream: **no Swift toolchain is installed in the current agent container** (`which swift` is empty); 001's Stream C downloaded `swift-6.2.1-RELEASE-ubuntu24.04` ad hoc (`apps/ios/VERIFY.md`). The iOS stream's first task installs it the same way (tarball from swift.org, or `swiftly`), verifies `swift --version` = 6.2.1 and `pkg-config --exists sqlite3` / `/usr/include/sqlite3.h`, and records the result. Without a toolchain the stream can only `swiftc -parse` nothing — it must not claim tests ran.
- No Xcode: everything importing SwiftUI/CoreLocation/CoreMotion/BackgroundTasks is reviewed by file list and recorded in `apps/ios/VERIFY.md` for a macOS run.
- Migrations: 002 adds `0003_auth_exports.sql`; 003 adds `0004_walks.sql`. If 002's numbering changes before 003 merges, renumber 003's migration (Stream C checks `drizzle/meta/_journal.json`).
