# Data Model: Weekly Reckoning

**Feature**: `004-weekly-reckoning` | **Date**: 2026-09-07

What this feature adds to the 001–003 schema (`specs/001-repo-foundations/data-model.md` §4, `specs/003-walk-tracking/data-model.md` §1), the API resource shapes (TypeBox `$id` names as they appear in the generated OpenAPI document), the job payloads and results, the walk-sim shapes and the configuration variables. Behavioural rules are in `plan.md` "Shared Semantics" and `research.md`; endpoints are in `contracts/openapi.yaml`.

---

## 1. Postgres changes (`apps/api/drizzle/0005_reckoning.sql`)

### 1.1 `reckonings`: resume state and counts [`src/db/schema/hexes.ts`]

| Column | Type | Notes |
|---|---|---|
| `stage` | `text` not null default `'walks'` | `walks \| cells \| rollup \| push \| done` (R1); the stage a rerun resumes at |
| `cursor_h3_r9` | `bigint` null | last cell id of the last committed batch; null before the first batch |
| `batches` | `integer` not null default 0 | committed batches |
| `parent_flips` | `integer` not null default 0 | parent owner changes caused by this week's flips |
| `walks_autofinished` | `integer` not null default 0 | stage `walks` result |
| `push_queued` | `integer` not null default 0 | stage `push` result |
| `error` | `text` null | last failure message (status `failed`); cleared when a rerun succeeds |
| `attempt` | `integer` not null default 1 | incremented on every resume |

Existing columns used: `week_id` (pk), `started_at`, `finished_at`, `hexes_processed`, `flips`, `status` (`running \| done \| failed`). A row is created at the start of a real run (`status = 'running'`), never for a dry run.

### 1.2 New table `hex_reckoning_history` [`src/db/schema/hexes.ts`]

| Column | Type | Notes |
|---|---|---|
| `h3_r9` | `bigint` not null | cell |
| `week_id` | `text` not null | reckoned week |
| `owner_faction_id` | `smallint` null fk `factions` | owner after the reckoning |
| `flipped` | `boolean` not null | `ReckonResult.flipped` |
| `from_faction` | `smallint` null | set when `flipped` |
| `to_faction` | `smallint` null | set when `flipped` |
| `captain_user_id` | `uuid` null fk `users` on delete set null | captain after the reckoning |
| `captain_before_user_id` | `uuid` null fk `users` on delete set null | captain before the reckoning (for "lost captaincy" pushes, R15) |
| `strengths` | `jsonb` not null default `'[]'` | `[{ "factionId": 1, "strength": 1234.5 }, …]` sorted by faction id (the rules package's output) |
| `had_contributions` | `boolean` not null default false | the cell had contributions in `week_id` |
| `reckoned_at` | `timestamptz` not null default now() | |

Primary key `(h3_r9, week_id)`; index `hex_reckoning_history_week_idx (week_id)`; partial index `hex_reckoning_history_captain_before_idx (week_id, captain_before_user_id) WHERE flipped` (push tally).

### 1.3 New table `reckoning_consistency` [`src/db/schema/hexes.ts`]

| Column | Type | Notes |
|---|---|---|
| `id` | `bigserial` pk | |
| `ran_at` | `timestamptz` not null default now() | |
| `parents_checked` | `integer` not null | rows recomputed from `hex_state` |
| `drifted` | `integer` not null | rows that differ (missing, extra, owner or counts) |
| `repaired` | `integer` not null default 0 | rows upserted (only with `repair: true`) |
| `sample` | `jsonb` not null default `'[]'` | ≤ 20 `{ h3, res, expectedOwner, actualOwner, expectedCounts, actualCounts, kind: 'missing' \| 'extra' \| 'owner' \| 'counts' }` |

### 1.4 Existing tables: changes and semantics fixed by this feature

| Table | Change / rule |
|---|---|
| `leaderboard_snapshots` | `user_id` becomes **nullable** (`ALTER COLUMN user_id DROP NOT NULL`); purge sets it to null (R17). Written only by stage `rollup`: scopes `global` (`scope_id = ''`) and `faction` (`scope_id = '<factionId>'`), `rank` 1…100, `meters` = Σ `capped_meters` for the week, `points` = Σ `points_ledger.points` for the week, `computed_at` = run time |
| `faction_stats_weekly` | written only by stage `rollup` (delete-then-insert per week): `hexes_owned_r9`, `hexes_owned_r7`, `meters` (Σ `capped_meters`), `active_users` (distinct contributors), `captures` (verified captures of the week, 0 until 006) |
| `points_ledger` | new partial unique index `points_ledger_hex_flip_unique (user_id, ref_id) WHERE kind = 'hex_flip'`; rows `kind = 'hex_flip'`, `points = 15`, `ref_type = 'hex_ownership_event'`, `ref_id = <event id>`, `h3_r9`, `week_id`, `faction_id = to_faction`; `users.xp += points` in the same transaction |
| `hex_faction_strength` | upserted per batch: `strength`, `last_reckoned_week = W`; rows for factions absent from `ReckonResult.strengths` are deleted |
| `hex_state` | inserted on first sight (`h3_r8..h3_r5` = `cellToParent`, `geom` = `cellPolygonWkt`, `version = 0`); updated per batch: `owner_faction_id`, `owner_since_week` (Shared Semantics 4), `captain_user_id`, `last_reckoned_week = W`, `last_activity_week = W` when contributions existed, `version += 1`. New index `hex_state_last_reckoned_idx (last_reckoned_week)` |
| `hex_ownership_events` | one row per flip: `week_id = W`, `from_faction`, `to_faction`, `cause = 'reckoning'`, `at = now()` |
| `hex_parent_state` | upserted per batch from deltas (R6): `res`, `geom` (on insert), `owner_faction_id`, `child_owner_counts` (`{"1": 3, "2": 2}` — claimed children only), `claimed_children`, `updated_at` |
| `hex_week_contribution` | **read only** (written by 003's `finishWalk`; `capture_bonus_m` by 006) |
| `walk_sessions` | touched only through 003's autofinish sweep |
| `captures` | counted only (`faction_stats_weekly.captures`) |
| `users` | `xp` incremented for flips; `role` read by the admin guard; `display_name` read for captains |

Drizzle: `src/db/schema/hexes.ts` gains `hexReckoningHistory`, `reckoningConsistency` and the `reckonings` columns; `src/db/schema/game.ts` drops `.notNull()` on `leaderboardSnapshots.userId`; `drizzle/meta/_journal.json` + `0005_snapshot.json` updated by `db:generate`, hand-checked (no `location_samples` DDL; `tablesFilter` excludes it).

### 1.5 Reckoning lifecycle

```text
(none) --runReckoning(W)--> running(stage walks, attempt 1)
running/walks --autofinish sweep--> running(stage cells, walks_autofinished)
running/cells --batch k committed--> running(cursor = last cell, batches = k, hexes_processed, flips, parent_flips)
running/cells --no more cells--> running(stage rollup)
running/rollup --snapshots written--> running(stage push)
running/push --rows queued--> done(finished_at, push_queued)
running/* --error--> failed(error, stage unchanged)      # rerun: status running, attempt + 1, resume at stage/cursor
done --runReckoning(W) again--> done (no-op, stored result returned)
```

---

## 2. API resource shapes (TypeBox `$id` names → OpenAPI component schemas)

All timestamps are ISO 8601 UTC strings; ids are UUID strings; H3 cells are 15-character lowercase hex strings; week ids match `^\d{4}-W\d{2}$`; `additionalProperties: false` everywhere.

### 2.1 Hex list (`GET /v1/hexes`)

| Schema | Fields |
|---|---|
| `HexListItem` | `h3: string`, `res: integer 5–9`, `owner: integer \| null`, `ownerSince: weekId \| null` (null for res 5–8), `pressureLeader: integer \| null` (null for res 5–8), `contested: boolean` (false for res 5–8) |
| `HexList` | `weekId: string` (the current week, `weekIdFor(now)`), `res: integer`, `items: HexListItem[]` (sorted by `h3`, ≤ 3 000) |

Query: `res` (integer, 5–9, required), `bbox` (string `minLon,minLat,maxLon,maxLat`, required).

### 2.2 Hex detail (`GET /v1/hexes/{h3}`)

| Schema | Fields |
|---|---|
| `FactionStrength` | `factionId: integer`, `strength: number ≥ 0` |
| `HexWeekFaction` | `factionId: integer`, `cappedMeters: number ≥ 0`, `bonusMeters: number ≥ 0`, `score: number ≥ 0` (Shared Semantics 9) |
| `HexWeek` | `weekId: string`, `factions: HexWeekFaction[]` (sorted by faction id), `pressureLeader: integer \| null`, `contested: boolean` |
| `HexCaptain` | `userId: uuid`, `displayName: string` |
| `HexMe` | `meters: number` (raw this week), `cappedMeters: number`, `explored: boolean`, `flipped: boolean`, `held: boolean` |
| `HexReckoningEntry` | `weekId: string`, `owner: integer \| null`, `flipped: boolean`, `from: integer \| null`, `to: integer \| null`, `strengths: FactionStrength[]`, `captain: HexCaptain \| null` |
| `HexDetail` | `h3: string`, `owner: integer \| null`, `ownerSince: weekId \| null`, `captain: HexCaptain \| null`, `strengths: FactionStrength[]`, `week: HexWeek`, `me: HexMe`, `reckonings: HexReckoningEntry[]` (newest first, ≤ 8), `captures: unknown[]` (always `[]` in 004; 006 defines the item schema) |

### 2.3 Latest reckoning (`GET /v1/reckonings/latest`)

| Schema | Fields |
|---|---|
| `FactionTotal` | `factionId: integer`, `hexesOwnedR9: integer`, `hexesOwnedR7: integer`, `meters: number`, `activeUsers: integer`, `captures: integer`, `flipsGained: integer`, `flipsLost: integer` |
| `ReckoningLatest` | `weekId: string \| null`, `ranAt: date-time \| null`, `nextAt: date-time`, `inProgress: string \| null` (week id of a running reckoning), `factionTotals: FactionTotal[]` (sorted by faction id), `myFlips: integer ≥ 0`, `myFlippedHexes: string[]` (≤ 200, sorted) |

### 2.4 Admin (`POST/GET /v1/admin/reckonings/{weekId}`)

| Schema | Fields |
|---|---|
| `ReckoningRunRequest` | `dryRun?: boolean` (default false), `sync?: boolean` (default false; required true when `dryRun`) |
| `FlipPreview` | `h3: string`, `from: integer \| null`, `to: integer \| null` |
| `ReckoningRunResult` | `weekId: string`, `dryRun: boolean`, `status: 'done'`, `resumed: boolean`, `hexesProcessed: integer`, `flips: integer`, `parentFlips: integer`, `walksAutofinished: integer`, `staleWalksSkipped: integer` (dry run only, else 0), `pushQueued: integer`, `leaderboardRows: integer`, `durationMs: integer`, `startedAt: date-time`, `finishedAt: date-time`, `flipsPreview: FlipPreview[]` (dry run: ≤ 1 000 entries; real run: `[]`) |
| `ReckoningQueued` | `weekId: string`, `status: 'queued'`, `jobId: string` |
| `ReckoningStatus` | `weekId`, `status: 'running' \| 'done' \| 'failed'`, `stage: 'walks' \| 'cells' \| 'rollup' \| 'push' \| 'done'`, `attempt: integer`, `startedAt`, `finishedAt: date-time \| null`, `hexesProcessed`, `flips`, `parentFlips`, `batches`, `walksAutofinished`, `pushQueued`, `error: string \| null` |

Path: `weekId` (`^\d{4}-W\d{2}$`).

### 2.5 Security and errors

`GET /v1/hexes*`, `GET /v1/reckonings/latest`: `security: [{ bearerAuth: [] }]` (any role). `/v1/admin/*`: `bearerAuth` **and** role `admin`. Error codes added to `apps/api/src/errors.ts`:

| Code | HTTP | Where |
|---|---|---|
| `BBOX_TOO_LARGE` | 400 | `GET /v1/hexes`; `details: { res, maxCells, estimatedCells }` |
| `WEEK_NOT_ENDED` | 400 | admin run for a week whose Monday 00:00 UTC end is in the future; `details.endsAt` |
| `RECKONING_OUT_OF_ORDER` | 409 | admin run / CLI for a week that is not the next in sequence; `details.expectedWeekId` |
| `RECKONING_RUNNING` | 409 | another run holds the lock; `details.weekId` when known |
| `RECKONING_NOT_FOUND` | 404 | `GET /v1/admin/reckonings/{weekId}` for an unknown week |
| `JOBS_DISABLED` | 503 | async admin run while `JOBS_ENABLED=false` |

Reused: `VALIDATION_FAILED` (400; `details.field` = `res`, `bbox`, `h3`, `weekId`, `dryRun`), `UNAUTHORIZED`/`TOKEN_EXPIRED`/`ACCOUNT_DELETED` (401), `FORBIDDEN` (403), `RATE_LIMITED` (429), `DB_UNAVAILABLE` (503).

---

## 3. Job payloads and results (pg-boss)

| Job | Schedule / data | Handler contract |
|---|---|---|
| `reckoning.weekly` | cron `RULES.RECKONING_CRON` (`0 0 * * 1`), tz `RULES.TZ`, `singletonKey: 'reckoning.weekly'`; data `{ weekId?: string }` | no `weekId` → `runDueReckonings(deps, now)`: every week from `nextWeekId(last done)` (or the earliest contribution week) to `justEndedWeek(now)` in order; with `weekId` → `runReckoning(deps, { weekId })`. Returns `ReckoningRunResult[]` / `ReckoningRunResult`. Also invoked once at start-up by `registerJobs` (catch-up). |
| `reckoning.consistency` | cron `RECKONING_CONSISTENCY_CRON` (`15 3 * * *` UTC), singleton, data `{ repair?: boolean }` (cron sends `{}`) | `runConsistency(deps, { repair })` → `{ parentsChecked, drifted, repaired, byRes: { 8: {…}, 7: {…}, 6: {…}, 5: {…} }, sample }`; writes one `reckoning_consistency` row; logs `error` when `drifted > 0` |
| `push.send` | queue created in `registerJobs`; **no worker in 004** | rows sent by stage `push`: `{ kind: 'reckoning_result', userId, weekId, flips: integer, lost: integer }`, `singletonKey: 'reckoning:<weekId>:<userId>'`, `startAfter: weekEndUtc(W) + 8 h`, `expireInHours: 24`, `retentionDays: 14` |

`ReckoningDeps` (`modules/territory/reckoning/run.ts`): `{ db, pool (dedicated client for the advisory lock), boss: JobBoss | null, clock, log, batchSize, autofinish?: () => Promise<{ finished: number }>, hooks?: { afterBatch?(n: number): Promise<void> } }` — `hooks` is test-only (crash injection, R19).

`src/jobs/run.ts` accepts `reckoning.weekly [--week YYYY-Www] [--dry-run]` and `reckoning.consistency [--repair]`; unknown flags exit 2.

---

## 4. `@nature/walk-sim` shapes

```ts
interface ReckonOptions { baseUrl: string; token: string; weekId: string; dryRun?: boolean; sync?: boolean /* default true */; fetch?: typeof fetch }
type ReckonResult = ReckoningRunResult | ReckoningQueued        // mirrors of data-model.md §2.4 in src/api-types.ts
function reckon(opts: ReckonOptions): Promise<ReckonResult>     // POST /v1/admin/reckonings/{weekId}; non-2xx → throws ApiError { code, status, details }
```

CLI: `walk-sim reckon <weekId> --base-url <url> --token <jwt> [--dry-run] [--async] [--json]`. Human output: one line per `flipsPreview` entry (`891f40… 1 → 2`) then a summary line (`2026-W37: 128 cells, 7 flips, 2 parent flips, 3 walks auto-finished, 12 pushes queued, 843 ms`); `--json` prints the raw result. Exit 0 on success, 1 on an API error (message = `code`), 2 on bad arguments.

---

## 5. Test helper shapes (`apps/api/test/helpers/reckoning.ts`)

```ts
seedFixtureWeeks(tdb, fixture: ReckoningWeeksFixture): Promise<{ users: Map<string, string> /* fixture id → uuid */, bonusUsers: Map<number, string> }>
runFixtureWeek(app, weekId, clock: FakeClock): Promise<ReckoningRunResult>       // sets the clock to weekEndUtc(weekId) + 1 s, runs synchronously
tableSnapshot(tdb, tables = ['hex_faction_strength','hex_state','hex_ownership_events','hex_parent_state','hex_reckoning_history','points_ledger','leaderboard_snapshots','faction_stats_weekly','reckonings']): Promise<Record<string, unknown[]>>   // ordered rows without volatile columns (`at`, `updated_at`, `computed_at`, `reckoned_at`, `started_at`, `finished_at`, `id`s), for row-for-row comparison
gridSeed(tdb, centre: string, k: number, opts: { factions: number[]; users: string[]; weekId: string }): Promise<number>   // gridDisk(centre, k) cells with strengths and contributions; returns the cell count
```

---

## 6. Configuration variables added to `apps/api/src/config.ts` / `.env.example`

| Variable | Type / default | Purpose |
|---|---|---|
| `RECKONING_BATCH_SIZE` | integer ≥ 1, default 1000 | cells per transaction (R1) |
| `HEX_BBOX_MAX_CELLS` | integer ≥ 1, default 3000 | `GET /v1/hexes` cap (R9) |
| `RECKONING_CONSISTENCY_CRON` | string, default `15 3 * * *` | nightly consistency schedule (UTC) |

Defaults equal the constants in `modules/territory/limits.ts`; `AppConfig` gains a `territory` group `{ batchSize, bboxMaxCells, consistencyCron }`. `SKIP_PERF` is a test-only environment variable (not part of the config schema).
