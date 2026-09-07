# Implementation Plan: Walk Tracking

**Branch**: `003-walk-tracking` | **Date**: 2026-09-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-walk-tracking/spec.md`

**Note**: This plan references `docs/architecture.md` (§4 "Walk tracking and path recording", §5 backend modules/jobs/endpoints/protection, §6 data model) and `docs/territory-rules.md` ("Walk acceptance", "Scoring at walk finish", "Between reckonings") instead of restating them. Deviations are listed under **Deviations** and justified. Feature 001's artefacts (Fastify `buildApp`, error envelope, `db`/`jobs`/`openapi` plugins, the Drizzle schema for `walk_sessions`, `location_samples`, `walk_hex_meters`, `hex_week_contribution`, `points_ledger`, `anti_cheat_flags`, the partition function, the test database helper, `H3Kit`, `TerritoryRules`, `AppContainer`, `RootView`, `project.yml`) and feature 002's artefacts (`auth` plugin with `request.user`, `rate-limit` plugin, purge and export registries, `registerJobs`, `@nature/api-schema` snapshot, iOS `Core`, `APIClient`, `AuthSession`, six tabs) are reused, not repeated. 002 is being implemented concurrently: this plan targets its **contract** (`specs/002-auth-and-factions/{plan,data-model}.md`, `contracts/openapi.yaml`), not its final code; where a 002 name is assumed it is listed in "Dependencies on 002".

## Summary

Add walk sessions end to end. **API**: `POST /v1/walks` (idempotent on `clientWalkId`, overlap guard, supersede), `POST /v1/walks/{id}/samples` (batches ≤ 200, idempotent by `(walkId, seq)`, store-only with a provisional filter answer), `POST /v1/walks/{id}/finish` (the only scoring path: re-filter → flags → simplify → `pathToHexMeters` → `walk_hex_meters` → `hex_week_contribution` upsert with `applyWeeklyCap` → `walk_distance` XP ledger → `weekStanding` read model; flagged walks store but score nothing), `GET /v1/walks?cursor=`, `GET /v1/walks/{id}` (owner only, with GeoJSON path), jobs `walk.autofinish` (hourly, > 12 h) and `samples.purge` (daily, 30-day partitions), ingest rate limits, purge step and export section for 002's registries, migration `0004_walks`, and a refreshed `@nature/api-schema` snapshot. **`@nature/walk-sim`**: a library + CLI that turns GPX/GeoJSON into timed sample batches, replays them against any base URL with a bearer token with distortions (`--speed --jitter --accuracy --teleport --spoof-no-steps --finish --rate`), and a `--dry-run` oracle used by the API integration tests; three generated Kaunas sample tracks. **iOS**: Linux-testable `Location` (`WalkTracker`, `PathRecorder`, `HexMetersEstimator`, `AutoPauseDetector`, `LivePath`, platform `CoreLocationSource` + `PedometerBridge`) and `Persistence` (GRDB `walk`, `location_sample`, `walk_path`, `outbox`; `SyncCoordinator` actor with back-off), `WalkFeature` (start/stop, HUD, auto-pause 3 min, auto-end 6 h, finish sheet, history with mini path), `Core` walk models + `WalksService`, generated client adapter, `Info.plist`/`project.yml` background-mode and usage strings. Three streams: **A api** (`apps/api`, `packages/walk-sim`, `packages/api-schema`), **B ios** (`apps/ios`), **C integration** afterwards. Decisions in `research.md` (R1–R20), shapes in `data-model.md`, endpoints in `contracts/openapi.yaml`, tasks in `tasks.md`.

## Technical Context

**Language/Version**: TypeScript 5.9 on Node 22 (`apps/api`, `packages/walk-sim`, `packages/api-schema`); Swift 6 / iOS 17+ (`Location`, `Persistence`, `WalkFeature`, additions to `Core`, `APIClient`, app target); SQL (Drizzle migration `0004_walks.sql`); YAML (`project.yml`).

**Primary Dependencies**: existing 001/002 stack (Fastify 5, TypeBox, `@fastify/swagger`, `@fastify/rate-limit`, Drizzle 0.44, `pg`, pg-boss 10, Vitest 3, `@nature/territory-rules`, `h3-js` 4) plus **new**: `commander` 13.x (MIT, CLI), `fast-xml-parser` 5.x (MIT, GPX) in `packages/walk-sim`; iOS: `GRDB.swift` 7.x (MIT, SPM) in `Persistence`; Apple frameworks `CoreLocation` (`CLLocationUpdate`, `CLBackgroundActivitySession`), `CoreMotion` (`CMPedometer`), `BackgroundTasks`, `Network` (`NWPathMonitor`). Exact versions: latest patch of the listed majors, frozen by Stream C in `pnpm-lock.yaml` / `Package.resolved`.

**Storage**: Postgres 16 + PostGIS (001 image): existing `walk_sessions`, `location_samples` (partitioned), `walk_hex_meters`, `hex_week_contribution`, `hex_faction_strength`, `hex_state`, `points_ledger`, `anti_cheat_flags`, `users`; **new** columns on `walk_sessions` (`finish_reason`, `device_info`, `xp_awarded`, `scored`) and one partial index (migration `0004_walks.sql`, `data-model.md` §1). Device: GRDB/SQLite database `nature.sqlite` in Application Support, schema v1 (`data-model.md` §5).

**Testing**: Vitest unit tests (rules-based pure functions: finish pipeline on fixture samples, standing, limits, cursor, walk-sim simulate/expected/parsers) and integration tests against the real Postgres via `DATABASE_URL` (skipped with `SKIP_DB_TESTS=1`): GPX replay through `app.inject` vs the walk-sim oracle, idempotency under re-delivery and reversed order, week boundary, cap, flagged walk, idempotent finish, overlap/supersede, autofinish, purge, FK coverage, snapshot staleness. Swift: `swift test` on Linux for `Location` (fixture-driven estimator ±0.5 m, filter parity, tracker state machine with `FakeLocationSource` + `FakeClock`, auto-pause, auto-end) and `Persistence` (GRDB in-memory: repository round-trips, outbox FIFO, back-off schedule, permanent-failure handling, vacuum); XCTest on macOS/Xcode Cloud for `WalkFeature` and the app target. `python3 -m unittest` unchanged.

**Target Platform**: Linux server (API, Compose); iOS 17+ (app). Agent containers: Node 22 + pnpm, local Postgres 16 + PostGIS, **no Swift toolchain preinstalled** (Stream B installs 6.2.1 as 001 did — research R20), no Xcode, no Docker, no git-lfs.

**Project Type**: Monorepo: mobile app + API + shared packages + CLI.

**Performance Goals**: `POST /v1/walks/{id}/samples` (200 samples) < 150 ms p95; `POST /v1/walks/{id}/finish` for a 2-hour walk (1 440 samples, ~30 cells) < 2 s p95 (SC-003 budget 5 s end to end); `GET /v1/walks` < 100 ms p95 (index `(user_id, started_at desc)`); autofinish job processes 1 000 stale walks in < 5 min; device: HUD update < 16 ms per accepted sample (one two-point `pathToHexMeters` call), battery < 6 %/h (SC-006, measured on device).

**Constraints**: Server-authoritative scoring only in `finishWalk` (Constitution I/II); `hex_state.owner_faction_id` is never written (004); no PostHog; When-In-Use only; samples only during a walk; paths private to their owner; raw samples 30 days server-side, 7 days device-side; single API instance (in-memory rate-limit windows, as accepted in 002); iOS logic to be unit-tested lives in Linux-buildable targets (FR-020); no rule change (fixtures unchanged).

**Scale/Scope**: 5 endpoints, 2 jobs, 1 migration, 1 new TS package (+ 3 sample tracks), 3 new Swift packages + additions to 2, 4 new screens/sheets (walk, finish sheet, history, detail), ≤ 10 000 players × ≤ 5 walks/week × ~700 samples in the beta.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this feature complies |
|---|---|---|
| I. Server-authoritative game state | PASS | Samples are stored raw; the only scoring code is `finishWalk` (R1) which recomputes from stored rows. The HUD estimate is labelled "estimate" and replaced by the server summary; `pedometerTotal`, `endedAt` and every client number are validated/clamped (R4) or used only as plausibility inputs. |
| II. One place for each rule | PASS | No rule or constant changes; the API imports `acceptSamples`, `walkFlags`, `simplifyPath`, `pathLengthM`, `pathToHexMeters`, `applyWeeklyCap`, `weekIdFor`, `RULES` from `@nature/territory-rules`; the app uses the Swift mirrors. Metres are scored only in `finishWalk`; ownership is untouched (`weekStanding` is a read model, R8). The daily XP cap and ingest limits are abuse limits kept in `modules/walks/limits.ts` with a doc-consistency test (R6, R10), as 002 did for account rules. |
| III. Licence before ship | PASS | No model, dataset, tile source or species image. New code dependencies (`commander` MIT, `fast-xml-parser` MIT, `GRDB.swift` MIT — already listed in `docs/licences.md` per 001) are code libraries; Stream C adds the `fast-xml-parser`/`commander` rows only if `docs/licences.md` tracks dev tooling (it does not; 002 added `swift-openapi-*` because it ships in the binary — GRDB already has a row). Sample GPX tracks are synthetic, generated by our script (no third-party data). |
| IV. Privacy by default | PASS | Paths are returned only to their owner (404 otherwise, R12/FR-013); raw samples purged after 30 days (R9) and 7 days on device (R17); purge step + export section registered with 002's registries (R13, FR-016); no analytics SDK; location only during a foreground-started walk with When-In-Use (R16). |
| V. Test at the layer you touch | PASS | Rules: fixtures unchanged and reused by the Swift estimator tests. API: unit + integration against the real Postgres (`DATABASE_URL`), replaying GPX through the routes with the walk-sim oracle. iOS: Linux `swift test` for `Location`/`Persistence`; macOS XCTest for `WalkFeature`/app recorded in `VERIFY.md`. `quickstart.md` is executable per stream. |
| VI. Small, mergeable steps | PASS | 30 tasks in three streams with disjoint paths; each task is one PR with an acceptance check. Deferred on purpose: flag clearing/re-scoring (008), live map path drawing (005), reckoning (004), `walk-sim --reckon` (004). |
| VII. Battery and offline are features | PASS | Durable outbox drained in order with back-off (R17); walk recording, HUD, local finish all work offline (US3); `liveUpdates(.fitness)` + throttling to ~1 sample / 5 s or 10 m, auto-pause after 3 min stationary, auto-end 6 h (R16); battery measured on device (SC-006) and recorded. When-In-Use only; `CLBackgroundActivitySession` shows the indicator. |
| Workflow: plan references architecture docs | PASS | This file links `docs/architecture.md` §4/§5/§6 and `docs/territory-rules.md`; deviations listed below. |
| Workflow: contracts as OpenAPI fragments, merged into `packages/api-schema`, iOS client generated | PASS | `contracts/openapi.yaml` is the reviewed fragment; Stream A refreshes `packages/api-schema/openapi.json`; Stream B regenerates the client from the snapshot (temporary conversion of the fragment if A has not merged, as in 002 T020). |
| Workflow: tunable constants only via `territory-rules.md` + `config.ts` | PASS | None changed; `limits.ts` holds non-territory abuse limits with a test that `docs/architecture.md` §5 states the same numbers (Stream C writes them). |

**Post-design re-check (after Phase 1)**: no new violations. Structural additions beyond `docs/architecture.md` §3: none — `packages/walk-sim`, `apps/ios/Packages/{Location,Persistence,WalkFeature}` are all listed there. One new file family: `apps/api/src/modules/walks/{limits,standing,purge,export-section}.ts` (module-internal).

## Project Structure

### Documentation (this feature)

```text
specs/003-walk-tracking/
├── spec.md              # Feature spec with Clarifications
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R20
├── data-model.md        # Phase 1: migration, API shapes, job payloads, walk-sim shapes, device schema, config
├── quickstart.md        # Phase 1: how to verify each stream and the whole feature
├── checklists/requirements.md
├── contracts/
│   └── openapi.yaml     # Phase 1: /v1/walks* (reviewed fragment)
└── tasks.md             # Phase 2: streams A–C
```

### Source Code (repository root)

Files created or changed by this feature, with the owning stream (`tasks.md` "Stream ownership"). Everything not listed stays as 001/002 left it.

```text
apps/api/                                        # Stream A
  package.json                                   # scripts job:autofinish, job:purge-samples; devDependency @nature/walk-sim (workspace:*)
  .env.example                                   # + WALK_* variables (data-model.md §7)
  src/config.ts                                  # + walks group
  src/errors.ts                                  # + WALK_NOT_FOUND, WALK_NOT_ACTIVE, WALK_OVERLAP, SAMPLE_QUOTA_EXCEEDED, FACTION_REQUIRED, INVALID_ENDED_AT
  src/app.ts                                     # registers walksRoutes
  src/db/schema/walks.ts                         # + finish_reason, device_info, xp_awarded, scored; partial index active_started
  drizzle/0004_walks.sql, drizzle/meta/*         # migration + journal/snapshot
  src/lib/h3.ts                                  # cellToBigInt / bigIntToCell (15-char lowercase hex)
  src/lib/geo.ts                                 # lineStringSql / geojson helpers for geography columns
  src/modules/walks/{schemas,routes,service,samples,finish,standing,limits,cursor,purge,export-section}.ts
  src/jobs/{walk-autofinish,samples-purge}.ts    # + registered in src/jobs/index.ts; run.ts gains both names
  test/helpers/walks.ts                          # createWalkFor(app, user), replayTrack(app, token, samples, {order, redeliver})
  test/unit/{walks-finish,walks-standing,walks-limits,walks-cursor,walks-schemas,jobs-registry}.test.ts
  test/integration/{walks-create,walks-samples,walks-finish,walks-history,walks-autofinish,samples-purge,walks-purge-export,schema}.test.ts

packages/walk-sim/                               # Stream A — @nature/walk-sim
  package.json  tsconfig.json  tsconfig.build.json  vitest.config.ts  README.md
  src/{index,cli,track,simulate,expected,replay,gpx,geojson,random}.ts
  scripts/generate-samples.ts                    # writes samples/*.gpx deterministically
  samples/{azuolynas-loop,laisves-aleja-straight,car-a1}.gpx
  test/{gpx,simulate,expected,replay,samples}.test.ts

packages/api-schema/openapi.json                 # Stream A — snapshot refreshed (`pnpm --filter @nature/api-schema snapshot`)

apps/ios/                                        # Stream B
  project.yml                                    # + packages Location, Persistence, WalkFeature
  NatureExplorer/Info.plist                      # + UIBackgroundModes [location], NSLocationWhenInUseUsageDescription, NSMotionUsageDescription, BGTaskSchedulerPermittedIdentifiers
  NatureExplorer/{AppContainer,RootView,App}.swift   # walks services, tracker, sync kicks (NWPathMonitor, BGAppRefreshTask), Walk tab
  Packages/Core/Sources/Core/Walks/{WalkModels,WalksService}.swift        # models of data-model.md §6, protocol
  Packages/Core/Tests/CoreTests/Walks/*.swift
  Packages/APIClient/Sources/APIClient/{openapi.json (synced copy), Adapters/WalksServiceLive.swift}
  Packages/Location/                             # Linux-testable core + #if canImport(CoreLocation) platform target
    Package.swift
    Sources/Location/{LocationFix,LocationSource,PedometerSource,PathRecorder,HexMetersEstimator,AutoPauseDetector,LivePath,WalkTracker,WalkStore,Clock}.swift
    Sources/Location/Platform/{CoreLocationSource,PedometerBridge}.swift
    Tests/LocationTests/{PathRecorderTests,HexMetersEstimatorTests,AutoPauseDetectorTests,WalkTrackerTests,Fakes/*,Fixtures.swift}
  Packages/Persistence/
    Package.swift
    Sources/Persistence/{Database,Migrations,WalkRepository,OutboxQueue,SyncCoordinator,Backoff,Records/*}.swift
    Tests/PersistenceTests/{WalkRepositoryTests,OutboxQueueTests,SyncCoordinatorTests,BackoffTests,VacuumTests,Fakes/*}
  Packages/WalkFeature/
    Package.swift
    Sources/WalkFeature/{WalkViewModel,WalkScreen,WalkHUDView,FinishSummarySheet,WalkHistoryList,WalkHistoryRow,MiniPathView,WalkDetailView,PermissionView}.swift
    Tests/WalkFeatureTests/{WalkViewModelTests,MiniPathGeometryTests}.swift
  Tests/NatureExplorerTests/WalkWiringTests.swift
  README.md, VERIFY.md                           # updated

Root / docs (Stream C only): package.json (if a script is needed), pnpm-lock.yaml, turbo.json (passthrough env), README.md, CLAUDE.md, docs/architecture.md §5 (limits numbers, jobs), docs/territory-rules.md (no constants change; wording only if needed), .github/workflows/api.yml, specs/003-walk-tracking/{quickstart.md log, analysis.md, tasks.md}
```

**Structure Decision**: Extends the 001/002 monorepo exactly as `docs/architecture.md` §3 lays out `walk-sim`, `Location`, `Persistence`, `WalkFeature`. No new top-level directories.

## Package, Target and Name Conventions (use everywhere)

| Thing | Name |
|---|---|
| Fastify module | `walks` (`/v1/walks`, `/v1/walks/{id}/samples`, `/v1/walks/{id}/finish`, `/v1/walks/{id}`), OpenAPI tag `walks`, `operationId`s `createWalk`, `uploadWalkSamples`, `finishWalk`, `listWalks`, `getWalk` |
| Scoring entry point | `finishWalk(tx, { walkId, endedAt, reason })` in `modules/walks/finish.ts` (R1) |
| Jobs | `walk.autofinish` (cron `0 * * * *`, singleton), `samples.purge` (cron `30 3 * * *`, singleton); runner names `job:autofinish`, `job:purge-samples` |
| Limits (`modules/walks/limits.ts`) | `SAMPLES_PER_BATCH = 200`, `BATCHES_PER_WINDOW = 30`, `BATCH_WINDOW = '15 minutes'`, `WALKS_PER_HOUR = 20`, `SAMPLES_PER_DAY = 8640`, `WALK_XP_PER_100M = 1`, `WALK_XP_DAILY_CAP = 300`, `AUTOFINISH_AFTER_H = 12`, `SAMPLE_RETENTION_DAYS = 30`, `START_CLAMP_PAST_H = 12`, `START_CLAMP_FUTURE_MIN = 5` |
| Error codes | `WALK_NOT_FOUND` 404, `WALK_NOT_ACTIVE` 409, `WALK_OVERLAP` 409, `SAMPLE_QUOTA_EXCEEDED` 429, `FACTION_REQUIRED` 403, `INVALID_ENDED_AT` 400 (+ 002's `RATE_LIMITED`, `UNAUTHORIZED`, `VALIDATION_FAILED`) |
| Walk statuses / finish reasons | `active | finished | flagged | abandoned` (001 enum, `abandoned` unused in 003); `finish_reason`: `client | autofinish | superseded` |
| H3 in JSON | 15-char lowercase hex string (`h3`), converted with `lib/h3.ts` to `bigint` columns |
| Paths in JSON | GeoJSON `LineString` (`coordinates: [[lon, lat], …]`) |
| Cursor | base64url(`${startedAtISO}|${walkId}`), page size default 20, max 50 |
| walk-sim | package `@nature/walk-sim`, bin `walk-sim`, subcommands `replay`, `dry-run`, `samples:generate`; library exports `parseTrack`, `simulate`, `expected`, `replay`, `SAMPLE_TRACKS` |
| Swift packages | `Location` (product `Location`), `Persistence` (product `Persistence`), `WalkFeature` (product `WalkFeature`) |
| Swift protocols | `Core.WalksService`, `Location.LocationSource`, `Location.PedometerSource`, `Location.WalkStore`, `Location.Clock` (reuse `Core.Clock` if 002 exports one), `Persistence.WalkRepository` |
| Observable path model | `Location.LivePath` (`@Observable @MainActor final class`) — consumed by 005 |
| Local DB | `nature.sqlite` (Application Support), GRDB `DatabaseMigrator` id `v1-walks` |
| Background task id | `com.natureexplorer.app.sync` |

## Shared Semantics (server and client must agree)

Defined once here so Streams A and B implement the same behaviour without reading each other's code. Types: `data-model.md`; endpoints: `contracts/openapi.yaml`.

1. **Sample shape**: `{ seq: int ≥ 0, ts: ISO 8601 UTC, lat, lon, hAcc: m, speed?: m/s|null, course?: deg|null, alt?: m|null }` — identical to `@nature/territory-rules` `Sample` and the Swift `TerritoryRules.Sample`. `seq` starts at 0 per walk and increases by 1 per *kept* sample (rejected-by-device fixes are never sent and consume no seq). A batch has 1–200 samples; batch order and delivery order are irrelevant to the final score.
2. **Device filter and throttle**: the app applies `acceptSamples` semantics incrementally (a fix is compared to the last *accepted* sample: non-monotonic → drop; `hAcc > 50` → drop; `speed > 5` → drop) and additionally keeps a fix only when ≥ 5 s have passed since the last kept sample **or** it moved ≥ 10 m from it. Only kept samples are stored locally and uploaded (accepted and rejected ones alike are sent so the server sees the same input; rejected-by-throttle fixes are never stored). The server re-runs `acceptSamples` on everything it stored.
3. **Creation**: `POST /v1/walks { clientWalkId, startedAt, deviceInfo? }` → `201 { walkId, clientWalkId, startedAt, status: 'active', superseded?: walkId }` or `200` with the same body when `(user, clientWalkId)` exists; `409 WALK_OVERLAP { activeWalkId }` per R3; `403 FACTION_REQUIRED` when the player has no faction. The client keys everything by `clientWalkId` and stores `walkId` when the response arrives.
4. **Batches**: `POST /v1/walks/{id}/samples { samples: [1..200], pedometer?: { steps, since, until } }` → `200 { stored, duplicates, accepted: [seq], rejected: [{seq, reason}], sampleCount }`; the client sends a batch every 60 s while recording or when 200 kept samples are pending; a walk that is not `active` answers `409 WALK_NOT_ACTIVE` and the client drops the walk's remaining outbox items and refreshes the walk. The `pedometer` block is optional per batch; the finish carries the total.
5. **Finish**: `POST /v1/walks/{id}/finish { endedAt, pedometerTotal?: int|null }` → `200 WalkSummary` (`data-model.md` §2.4). On an already finished walk the same summary is returned (`finishedAt` unchanged). `endedAt` before `startedAt` → `400 INVALID_ENDED_AT`; otherwise it is clamped (R4). The client shows the server summary and stores it verbatim; the local provisional summary is discarded.
6. **Week id**: `weekIdFor(endedAt')` in UTC (`YYYY-Www`); the summary carries it; the client never computes the week for scoring (it may compute it for display with the mirrored `weekIdFor`).
7. **Flags**: `flags: ['teleport'|'speed'|'distance'|'no_steps']`; non-empty ⇒ `status = 'flagged'`, `scored = false`, `xp = 0`, every `hexes[].cappedMeters = 0`, contributions untouched. The client shows "This walk was flagged (reason) and earned no metres" and lists the hexes anyway.
8. **Week standing**: per hex `{ leader: factionId|null, myFactionShare: 0…1, owner: factionId|null }` per R8; informational, never used by the client for anything but display.
9. **History**: `GET /v1/walks?cursor&limit` → `{ items: WalkListItem[], nextCursor }`, newest first; `GET /v1/walks/{id}` → `WalkDetail` (summary + `path`), `404 WALK_NOT_FOUND` for any walk the caller does not own. The client merges local walks whose `sync_state ≠ synced` on top of the first page (marked "pending upload"/"failed").
10. **Autofinish**: server finishes walks active > 12 h with `endedAt = lastAcceptedSampleTs ?? startedAt`, `finishReason = 'autofinish'`. A client finish arriving later gets the stored summary (rule 5). The client, on relaunch, finishes any local walk still recording (`endedAt = last kept sample ts`) and enqueues the finish; if the server already auto-finished it, rule 5 applies.
11. **Auto-pause / auto-end (client only)**: paused after 180 s without an accepted sample ≥ 10 m from the last one (or 180 s of `isStationary`); resumed on the first such sample; moving time excludes pauses; recording (and uploading) continues during pauses so the server sees the stationary samples (they add ~0 m). Auto-end at 6 h of wall time since start → normal finish with `endedAt = now`.
12. **Rate limits**: `429 RATE_LIMITED { retryAfterS }` / `429 SAMPLE_QUOTA_EXCEEDED { retryAfterS }` with a `retry-after` header; the client's sync coordinator waits `retryAfterS` (min 5 s) before the next attempt and never drops items for a 429.
13. **Permanent vs retryable failures (client)**: retry with back-off on network errors, 5xx, 408, 429; permanent on any other 4xx — the walk is marked `failed` with the error code, its remaining outbox items are deleted, later walks continue.
14. **Errors**: every non-2xx uses the 001 `Error` envelope; the client maps `error.code` to `APIError` cases (002) extended with the walk codes.

## Deviations from `docs/architecture.md` / `docs/territory-rules.md` / 001 / 002

| Deviation | Justification |
|---|---|
| `POST /v1/walks/{id}/samples` returns `stored`/`duplicates`/`sampleCount` in addition to §5's `{accepted, rejected}`, and `accepted`/`rejected` are **provisional** | The partition key prevents a `(walk_id, seq)` unique index, so the app must be told which rows were new; the provisional label keeps Constitution I honest (R2). |
| `POST /v1/walks` may auto-finish ("supersede") the player's stale active walk | §5 names an "overlapping-walk guard" without defining it; a strict 409 would lock out a player whose phone died for up to 12 h (R3). Genuine overlaps are still refused. |
| `walk_sessions` gains `finish_reason`, `device_info`, `xp_awarded`, `scored` | §6 has no column for who finished the walk or whether it was scored; the history UI and 008's re-scoring need them; `device_info` keeps §5's `deviceInfo` without creating `devices` rows (those belong to push, 008). |
| Daily walking-XP cap (300) and ingest limits live in `modules/walks/limits.ts`, not in `packages/territory-rules` | Abuse limits, not territory rules; the client never evaluates them; same reasoning and mechanism (doc-consistency test) as 002's account rules. |
| `samples.purge` job is included (task list named only `walk.autofinish`) | Constitution IV's 30-day raw retention would otherwise be unenforced from the first walk; `0001_partitions.sql` assigned it to 003. |
| Two rate-limit windows (`30 / 15 min` for batches, `20 / h` for creations) instead of a token bucket "2 batches/min" | 002 established `@fastify/rate-limit` fixed windows in memory; the 15-minute window preserves the 2/min average while letting an offline walk drain (R10). |
| `UIBackgroundModes = [location]` only (§4 says `[location, audio]`) | Audio background mode is added by 006 when there is something to justify it to App Review. |
| Live path is not drawn on the map in 003 | Binding decision; `LivePath` is the observable model 005 consumes. |
| No `POST /v1/walks/{id}/abandon` | Not in §5; `abandoned` status stays unused until a feature needs it (autofinish covers lost walks). |

## Complexity Tracking

No constitution violations to justify. The provisional filter on ingest (R2) and the supersede rule (R3) are the two places where the design is more than the minimum; both are documented with the simpler alternative and why it was rejected.

## Dependencies on 002 (Stream A and B must wait for these to be merged, or code against their contract)

| 002 artefact | Used by | If not merged yet |
|---|---|---|
| `auth` plugin: `fastify.authenticate`, `request.user { id, role, factionId? }` (002 T007) | every walk route | A: code against the name; wire `preHandler: [fastify.authenticate]`; the integration helper `signInTestUser` (002 T008) creates users — until it exists use a local helper that inserts a user and signs an HS256 token with 002's claims (`data-model.md` 002 §3). |
| `rate-limit` plugin (`config.rateLimit` per route, `RATE_LIMITED` envelope) (002 T007) | samples and create routes | A: same plugin options; if absent, register `@fastify/rate-limit` locally in the walks module with `global: false`. |
| Purge registry (`modules/me/purge.ts`, FK-coverage test) and export-section registry (002 T011–T013) | `walks/purge.ts`, `walks/export-section.ts` | A: implement the two files against 002's `PurgeStep { name, run(tx, userId) }` / `ExportSection { name, run(db, userId) }` shapes (002 data-model §4/§5); registration lines go in when the registries exist (Stream C checks). |
| `registerJobs(boss, deps)` in `src/jobs/index.ts` (002) | `walk-autofinish`, `samples-purge` | A: export `registerWalkAutofinish` / `registerSamplesPurge` with 001's `registerReckoningWeekly` signature; add to the registry when it exists. |
| Migration `0003_auth_exports.sql` | `0004_walks.sql` numbering | Renumber if needed (R20). |
| `@nature/api-schema` package + `snapshot` script (002 T015) | snapshot refresh | A: if absent, create nothing — Stream C runs the snapshot after both merge. |
| iOS `Core` (`Me`, `APIError`, `AuthSession`, `Clock`), `APIClient` (generator config, `openapi.json` copy, `AuthMiddleware`), `AppContainer` services, six tabs (002 T017–T025) | all of Stream B | **B must start after 002's Stream B is merged** (it edits the same packages); it may prototype `Location`/`Persistence` earlier since they depend only on `H3Kit`/`TerritoryRules` and on `Core` protocols they can define locally and move later. |

## Owner actions

1. Provide the usage-description copy for `NSLocationWhenInUseUsageDescription` and `NSMotionUsageDescription` (placeholders are written in English; localisation is 009).
2. Measure SC-006 (battery) on an iPhone 13 with `xctrace` once a TestFlight build exists; record in `apps/ios/VERIFY.md`.
3. Confirm the 300 XP/day walking cap (or another number) before public TestFlight; it is one constant in `limits.ts` and one line in `docs/architecture.md` §5.

## Environment notes for implementation agents

- **Stream A**: Node 22 + pnpm; `DATABASE_URL=postgres://nature:nature@localhost:5432/nature` for the integration suites (no Docker); the local Postgres has PostGIS (needed for `ST_MakeLine`, `ST_AsGeoJSON`). Do not hand over `node_modules`, `dist` or a lockfile; install package-locally with `pnpm install --filter` if a dependency is added and tell Stream C.
- **Stream B**: install the Swift 6.2.1 Linux toolchain first (R20; the container has none); `swift test` runs for `H3Kit`, `TerritoryRules`, `Core`, `Location`, `Persistence` (GRDB needs `sqlite3.h` — present); SwiftUI/CoreLocation/CoreMotion/BackgroundTasks files are parse-checked (`swiftc -parse -swift-version 6`) and listed in `VERIFY.md` for a macOS run. Do not commit a generated client or `.build`.
- **Stream C**: regenerates `pnpm-lock.yaml`, runs the snapshot and `sync-openapi.sh`, edits root files and docs, runs `/speckit-analyze` and `/speckit-converge`.
- Set `export SPECIFY_FEATURE=003-walk-tracking SPECIFY_FEATURE_DIRECTORY=specs/003-walk-tracking` before any `.specify/scripts/bash/*.sh` script or Spec Kit skill.
