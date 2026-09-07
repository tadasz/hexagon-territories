# Data Model: Walk Tracking

**Feature**: `003-walk-tracking` | **Date**: 2026-09-07

What this feature adds to the 001/002 schema (`specs/001-repo-foundations/data-model.md` §4, `specs/002-auth-and-factions/data-model.md`), the API resource shapes (TypeBox `$id` names as they appear in the generated OpenAPI document), the job payloads, the walk-sim shapes, the device-side GRDB schema, the iOS `Core` mirrors and the configuration variables. Behavioural rules are in `plan.md` "Shared Semantics" and `research.md`; endpoints are in `contracts/openapi.yaml`.

---

## 1. Postgres changes (`apps/api/drizzle/0004_walks.sql`)

### 1.1 `walk_sessions`: new columns and index [`src/db/schema/walks.ts`]

| Column | Type | Notes |
|---|---|---|
| `finish_reason` | `text` null | `'client' \| 'autofinish' \| 'superseded'`; null while active |
| `device_info` | `jsonb` null | `{ model?, osVersion?, appVersion? }` from `POST /v1/walks`; strings ≤ 64 chars |
| `xp_awarded` | `integer` not null default 0 | points of the `walk_distance` ledger row (0 when flagged or capped out) |
| `scored` | `boolean` not null default false | true once contributions/XP were written (false for flagged walks; 008's re-score flips it) |

Index: `walk_sessions_active_started_idx ON walk_sessions (started_at) WHERE status = 'active'` (autofinish scan). Existing columns used: `ended_at` (clamped client end, R4), `finished_at` (server transaction time), `week_id`, `distance_m`, `duration_s`, `steps` (= `pedometerTotal`), `path`, `path_simplified`, `sample_count`, `hex_count`, `flags`, `status`, `faction_id` (set at creation, re-read at finish).

### 1.2 Existing tables: semantics fixed by this feature

| Table | Rule |
|---|---|
| `location_samples` | `(walk_id, seq)` uniqueness is enforced in the application (R2) because the PK is `(walk_id, seq, ts)`; `accepted`/`reject_reason` are provisional after a batch and final after `finishWalk`; rows live in monthly partitions dropped after 30 days by `samples.purge` |
| `walk_hex_meters` | one row per (walk, res-9 cell) with raw metres, written for flagged walks too; `meters` ≥ 0.01 (rules package drops smaller) |
| `hex_week_contribution` | upserted only by `finishWalk` for unflagged walks: `meters += walkMeters`, `capped_meters = min(meters, 2000)`, `walks += 1`, `updated_at = now()`; `capture_bonus_m` untouched (006) |
| `points_ledger` | one `walk_distance` row per scored walk: `points = min(floor(distance/100), remaining daily cap)`, `ref_type = 'walk'`, `ref_id = walk id`, `week_id`, `faction_id`; `users.xp += points` in the same transaction |
| `anti_cheat_flags` | one row per flag of a flagged walk: `code` = flag, `details = { distanceM, durationS, medianSpeedMps, steps, sampleCount }`, `resolved_at` null |
| `hex_faction_strength`, `hex_state` | read only (week standing, R8) |

Drizzle: `drizzle/meta/_journal.json` + `0004_snapshot.json` updated by `db:generate`, hand-checked (no `location_samples` DDL; `tablesFilter` excludes it).

### 1.3 Walk lifecycle (server)

```text
(none) --POST /v1/walks--> active(faction_id = user's faction, started_at clamped)
active --POST samples--> active(sample_count += stored)
active --POST finish (client) | walk.autofinish | superseded by a new walk--> finishWalk:
        flags == []  --> finished(scored = true, xp_awarded, week_id, contributions upserted, ledger row)
        flags != []  --> flagged(scored = false, xp_awarded = 0, anti_cheat_flags rows)
finished | flagged --POST finish again--> unchanged; stored summary returned
any --account.purge (002) → walks purge step--> rows gone (ledger, flags, contributions, walks ⇒ samples, hex meters)
```

---

## 2. API resource shapes (TypeBox `$id` names → OpenAPI component schemas)

All timestamps are ISO 8601 UTC strings; ids are UUID strings; H3 cells are 15-character lowercase hex strings; `additionalProperties: false` everywhere.

### 2.1 Requests

| Schema | Fields |
|---|---|
| `WalkCreateRequest` | `clientWalkId: uuid`, `startedAt: date-time`, `deviceInfo?: { model?: string ≤ 64, osVersion?: string ≤ 32, appVersion?: string ≤ 32 }` |
| `LocationSample` | `seq: integer ≥ 0`, `ts: date-time`, `lat: number [-90, 90]`, `lon: number [-180, 180]`, `hAcc: number ≥ 0`, `speed?: number ≥ 0 \| null`, `course?: number [0, 360) \| null`, `alt?: number \| null` |
| `PedometerWindow` | `steps: integer ≥ 0`, `since: date-time`, `until: date-time` |
| `SampleBatchRequest` | `samples: LocationSample[] (1–200)`, `pedometer?: PedometerWindow` |
| `WalkFinishRequest` | `endedAt: date-time`, `pedometerTotal?: integer ≥ 0 \| null` |

### 2.2 Creation and batches

| Schema | Fields |
|---|---|
| `WalkCreated` | `walkId: uuid`, `clientWalkId: uuid`, `startedAt`, `status: 'active'`, `supersededWalkId: uuid \| null` |
| `RejectedSample` | `seq: integer`, `reason: 'accuracy' \| 'speed' \| 'non_monotonic'` |
| `SampleBatchResult` | `stored: integer` (new rows), `duplicates: integer` (seqs already present), `accepted: integer[]` (seqs provisionally accepted among the new rows), `rejected: RejectedSample[]`, `sampleCount: integer` (walk total) |

### 2.3 Week standing

| Schema | Fields |
|---|---|
| `WeekStanding` | `leader: integer \| null` (faction id with the highest score, ties → lowest id, null when all scores are 0), `myFactionShare: number [0, 1]` (3 decimals), `owner: integer \| null` (current `hex_state.owner_faction_id`, informational) |

Score per faction = `strength × 0.5 + Σ capped_meters + Σ capture_bonus_m` for `(h3, weekId)`.

### 2.4 Summary, detail, list

| Schema | Fields |
|---|---|
| `WalkHex` | `h3: string`, `meters: number` (raw metres of this walk), `cappedMeters: number` (metres that counted toward the weekly cap; 0 when flagged), `weekStanding: WeekStanding` |
| `WalkSummary` | `walkId`, `clientWalkId`, `status: 'active' \| 'finished' \| 'flagged' \| 'abandoned'`, `finishReason: 'client' \| 'autofinish' \| 'superseded' \| null`, `startedAt`, `endedAt: string \| null`, `finishedAt: string \| null`, `weekId: string \| null`, `distanceM: number`, `durationS: integer`, `steps: integer \| null`, `sampleCount: integer`, `hexCount: integer`, `xp: integer`, `scored: boolean`, `flags: ('teleport' \| 'speed' \| 'distance' \| 'no_steps')[]`, `hexes: WalkHex[]` (sorted by `h3`), `path: LineString \| null` (simplified; null when < 2 accepted samples) |
| `WalkListItem` | `WalkSummary` without `hexes` and `path` (+ `hexCount`, `xp`, `flags`) |
| `WalkListPage` | `items: WalkListItem[]`, `nextCursor: string \| null` |
| `WalkDetail` | = `WalkSummary` (alias kept so the client has one type for detail and finish) |
| `LineString` | `type: 'LineString'`, `coordinates: [number, number][]` (`[lon, lat]`, ≥ 2 points) |

### 2.5 Security and errors

Every walk route: `security: [{ bearerAuth: [] }]` (002 scheme). Error codes added to `apps/api/src/errors.ts`:

| Code | HTTP | Where |
|---|---|---|
| `WALK_NOT_FOUND` | 404 | unknown id or not the caller's walk (never distinguishes) |
| `WALK_NOT_ACTIVE` | 409 | samples for a finished/flagged walk |
| `WALK_OVERLAP` | 409 | creation whose `startedAt` is not after the active walk's last activity; `details.activeWalkId` |
| `FACTION_REQUIRED` | 403 | creation by a player without a faction |
| `INVALID_ENDED_AT` | 400 | `endedAt < startedAt` |
| `SAMPLE_QUOTA_EXCEEDED` | 429 | daily 8 640 stored samples; `details.retryAfterS`, `retry-after` header |

Reused: `VALIDATION_FAILED` (400; batch > 200 or malformed cursor → `details.field`), `UNAUTHORIZED`/`TOKEN_EXPIRED`/`ACCOUNT_DELETED` (401), `RATE_LIMITED` (429), `DB_UNAVAILABLE` (503).

---

## 3. Job payloads (pg-boss)

| Job | Schedule / data | Handler contract |
|---|---|---|
| `walk.autofinish` | cron `0 * * * *`, singleton, no data | for each `walk_sessions` row with `status = 'active' AND started_at < now() − 12 h`: `finishWalk(tx, { walkId, endedAt: lastAcceptedTs ?? startedAt, reason: 'autofinish' })` in its own transaction; returns `{ finished: number, failed: number, walkIds: string[] }`; safe to run concurrently with client finishes (`FOR UPDATE`, second caller sees non-active and returns) |
| `samples.purge` | cron `30 3 * * *`, singleton, no data | `DETACH` + `DROP` every `location_samples_yYYYYmMM` whose range end `< now() − 30 days`; `ensure_location_samples_partition(next month)`; returns `{ dropped: string[], ensured: string }` |
| `account.purge` (002) | unchanged | now runs the `walks` step (§1.3) |

`src/jobs/run.ts` accepts `walk.autofinish` and `samples.purge`.

---

## 4. `@nature/walk-sim` shapes

```ts
interface TrackPoint { lat: number; lon: number; ts?: string; ele?: number }
interface Track { name: string; points: TrackPoint[] }                 // parseTrack(text, 'gpx' | 'geojson')
interface SimulateOptions {
  speedMps?: number;        // resample at constant pace; default: track timestamps, else 1.4
  jitterM?: number;         // Gaussian σ applied to lat/lon (seeded), default 0
  accuracyM?: number;       // reported hAcc, default 8
  teleport?: boolean;       // insert one 400 m jump (5 s) at the midpoint
  spoofNoSteps?: boolean;   // pedometerSteps = 0
  stepsPerM?: number;       // default 1.3 (pedometerSteps = round(distance × stepsPerM)) unless spoofNoSteps
  sampleEveryS?: number;    // default 5
  startAt?: string;         // default track's first timestamp or 2026-09-07T08:00:00Z
  seed?: number;            // default 20260907
}
interface Simulated { samples: Sample[]; pedometerSteps: number | null; distanceM: number }
interface Expected {         // expected(samples, pedometerSteps) — the oracle
  acceptedSeqs: number[]; rejected: { seq: number; reason: RejectReason }[]; flags: WalkFlag[];
  distanceM: number; simplifiedPointCount: number; hexes: { cell: string; meters: number }[];
}
interface ReplayOptions { baseUrl: string; token: string; batchSize?: number /* ≤ 200 */; rate?: number /* 0 = asap, 1 = real time */; finish?: boolean; clientWalkId?: string; fetch?: typeof fetch }
interface ReplayResult { walkId: string; batches: SampleBatchResult[]; summary: WalkSummary | null }
```

Sample GPX files (`samples/`): GPX 1.1, one `<trk>` with one `<trkseg>`, `<trkpt lat lon><time>…Z</time></trkpt>`, generated by `scripts/generate-samples.ts` (seed 20260907; R15). `SAMPLE_TRACKS = { azuolynasLoop, laisvesAlejaStraight, carA1 }` resolve to absolute paths.

---

## 5. Device schema (GRDB, `Persistence`, migration `v1-walks`)

| Table | Columns | Notes |
|---|---|---|
| `walk` | `id TEXT PK` (client walk id), `server_id TEXT`, `started_at REAL`, `ended_at REAL`, `status TEXT` (`recording \| paused \| finishing \| finished`), `finish_reason TEXT`, `distance_m REAL`, `moving_s INTEGER`, `steps INTEGER`, `hex_count INTEGER`, `xp INTEGER`, `flags TEXT` (JSON), `summary TEXT` (JSON `WalkSummary` once synced), `sync_state TEXT` (`pending \| syncing \| synced \| failed`), `sync_error TEXT`, `updated_at REAL` | index `(started_at DESC)` |
| `location_sample` | `walk_id TEXT`, `seq INTEGER`, `ts REAL`, `lat REAL`, `lon REAL`, `h_acc REAL`, `speed REAL`, `course REAL`, `alt REAL`, `accepted INTEGER`, `reject_reason TEXT`, `outbox_id INTEGER NULL` | PK `(walk_id, seq)`; `outbox_id` set when the sample is included in a batch item; rows of `synced` walks deleted after 7 days |
| `walk_path` | `walk_id TEXT PK`, `points BLOB` (JSON `[[lat, lon], …]` of accepted samples), `hex_estimates BLOB` (JSON `{ "h3": meters }`), `updated_at REAL` | kept forever (history preview) |
| `outbox` | `id INTEGER PK AUTOINCREMENT`, `walk_id TEXT`, `kind TEXT` (`create \| samples \| finish`), `payload BLOB` (JSON request body), `attempts INTEGER`, `next_attempt_at REAL`, `last_error TEXT`, `created_at REAL` | index `(next_attempt_at, id)`; FIFO per walk |

Local walk lifecycle: `recording ⇄ paused → finishing → finished`; `sync_state`: `pending → syncing → synced | failed`.

---

## 6. iOS `Core` models and protocol (Swift, Foundation-only)

| Type | Shape |
|---|---|
| `WalkCreateRequest`, `WalkCreated`, `LocationSampleDTO` (= `TerritoryRules.Sample` re-exported or mirrored), `PedometerWindow`, `SampleBatchRequest`, `SampleBatchResult`, `RejectedSampleDTO`, `WalkFinishRequest`, `WeekStanding`, `WalkHex`, `WalkSummary`, `WalkListItem`, `WalkListPage`, `LineString` | mirror §2 (`Codable`, `Sendable`, `Equatable`); dates as `Date` |
| `WalkStatus` (`active, finished, flagged, abandoned`), `FinishReason` (`client, autofinish, superseded`), `WalkFlag` (reuse `TerritoryRules.WalkFlag`) | enums with raw values = wire strings |
| `APIError` (002) | + `walkNotFound`, `walkNotActive`, `walkOverlap(activeWalkId: String)`, `factionRequired`, `invalidEndedAt`, `sampleQuotaExceeded(retryAfterS: Int?)` |
| `WalksService` | `createWalk(_:) async throws -> WalkCreated`; `uploadSamples(walkId:_:) async throws -> SampleBatchResult`; `finishWalk(walkId:_:) async throws -> WalkSummary`; `listWalks(cursor:limit:) async throws -> WalkListPage`; `walk(id:) async throws -> WalkSummary` |
| `Location` presentation values | `HUDState { movingSeconds, distanceM, currentCell: H3Index?, currentCellMeters, hexCount, isPaused, waitingForGPS }`, `ProvisionalSummary { distanceM, movingSeconds, hexes: [(H3Index, Double)] }` |

---

## 7. Configuration variables added to `apps/api/src/config.ts` / `.env.example`

| Variable | Type / default | Purpose |
|---|---|---|
| `WALK_AUTOFINISH_AFTER_H` | integer, default 12 | autofinish threshold |
| `WALK_SAMPLE_RETENTION_DAYS` | integer, default 30 | partitions older than this are dropped |
| `WALK_XP_DAILY_CAP` | integer, default 300 | daily `walk_distance` XP cap |
| `WALK_INGEST_BATCHES_PER_15MIN` | integer, default 30 | batch rate window |
| `WALK_SAMPLES_PER_DAY` | integer, default 8640 | daily stored-sample quota |

Defaults equal the constants in `modules/walks/limits.ts`; the env only overrides them for load tests. `AppConfig` gains a `walks` group.
