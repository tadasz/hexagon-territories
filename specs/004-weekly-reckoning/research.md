# Research: Weekly Reckoning

**Feature**: `004-weekly-reckoning` | **Date**: 2026-09-07

Phase 0 of `plan.md`. Every design choice that is not already fixed by `docs/architecture.md` §5/§6, `docs/territory-rules.md`, the rules package or the feature's binding decisions is resolved here as a numbered decision (R1–R20) with rationale and rejected alternatives. Later documents reference these numbers.

## R1. One entry point, four stages, a persisted cursor

**Decision**: `apps/api/src/modules/territory/reckoning/run.ts` exports `runReckoning(deps, { weekId, dryRun })` and `runDueReckonings(deps, now)`. A run proceeds through stages persisted in `reckonings.stage`: `walks` (auto-finish stale walks via 003's sweep) → `cells` (batches of `RECKONING_BATCH_SIZE` = 1 000 cells ordered by `h3_r9`, cursor `reckonings.cursor_h3_r9`) → `rollup` (leaderboards, faction stats) → `push` (queue rows) → `done`. Each batch is one transaction that writes every result of its cells **and** the new cursor; each later stage is one transaction that is idempotent on its own (delete-then-insert for the week, `singletonKey` for pushes). A run that finds a `reckonings` row in `running` for the same week resumes from its `stage`/cursor. A row in `done` returns the stored result without touching anything.

**Rationale**: FR-009 (idempotent, resumable) with the simplest possible invariant: "everything committed is consistent, the cursor says how far we got". A crash loses at most one batch's uncommitted work.

**Alternatives rejected**: one giant transaction (locks 10 000 cells for minutes; a crash loses everything); per-cell transactions (10 000 commits, slow); marking cells with `last_reckoned_week` as the only progress marker (works for cells but not for the rollup stages — kept as a second guard, see R4).

## R2. Sequencing: which week, and catching up

**Decision**: `modules/territory/weeks.ts` provides `justEndedWeek(now)` (= `weekIdFor(startOfIsoWeekUtc(now) − 1 ms)`), `nextWeekId(w)`, `previousWeekId(w)`, `weekEndUtc(w)` (Monday 00:00 UTC after the week), `isCompleted(w, now)`, `nextReckoningAt(now)`. `runDueReckonings(deps, now)` computes `from` = `nextWeekId(last done reckoning)` or, when none exists, the earliest `week_id` in `hex_week_contribution` (or `justEndedWeek(now)` if there are no contributions at all), and runs every week from `from` to `justEndedWeek(now)` in order, stopping at the first failure. The cron handler and the API start-up (`onReady`, when jobs are enabled) both call it; the manual runner and the admin endpoint call `runReckoning` for one explicit week and enforce the sequence: `weekId` must be `expectedWeekId` (409 `RECKONING_OUT_OF_ORDER` with `details.expectedWeekId`), unless it is already `done` (answer the stored result) — a week older than the last done one is therefore always a no-op.

**Rationale**: FR-001; decay must be applied exactly once per week, so weeks cannot be skipped or reordered. Deriving the first week from the contributions avoids orphaning metres earned before the first ever reckoning.

**Alternatives rejected**: always reckoning only `justEndedWeek(now)` (silently skips missed weeks, leaving strengths un-decayed); allowing arbitrary weeks (breaks the decay invariant).

## R3. Concurrency: singleton job plus advisory lock

**Decision**: the pg-boss schedule uses `singletonKey: 'reckoning.weekly'`; in addition `runReckoning` takes `pg_try_advisory_lock(RECKONING_LOCK_KEY)` on a dedicated client for the duration of the run and releases it in `finally`. If the lock is held the run throws `ReckoningRunningError` → 409 `RECKONING_RUNNING` on the endpoint, exit 1 on the CLI. `reckoning.consistency` takes the same lock (with repair) or none (read-only report).

**Rationale**: pg-boss singletons protect against duplicate jobs but not against the manual runner or the admin endpoint running at the same time as the job.

**Alternatives rejected**: a `status = 'running'` row as the lock (stale after a crash; R1 needs `running` to mean "resume me").

## R4. Cell selection and per-cell inputs

**Decision**: the cell set for week W is `SELECT h3_r9 FROM hex_faction_strength UNION SELECT h3_r9 FROM hex_week_contribution WHERE week_id = W`, filtered `h3_r9 > cursor`, ordered, `LIMIT batchSize`. For the batch, three queries load: strengths (`hex_faction_strength` rows), states (`hex_state` rows: owner, captain), contributions (`hex_week_contribution` rows for W: faction, user, `meters`, `capped_meters`, `capture_bonus_m`). Cells whose `hex_state.last_reckoned_week = W` are skipped (second idempotency guard; they can only exist after a crash between the cursor write and... never, but the guard is free). Per cell the job builds `Contribution[]` from raw `meters`, calls `applyWeeklyCap`, cross-checks against stored `capped_meters` (warn on drift, never fail), builds `ReckonInput { cell, owner, strengths, contributions: capped rows with userId, bonuses: per-faction Σ capture_bonus_m }` and calls `reckonWeek`.

**Rationale**: FR-002/FR-003 and Constitution II ("never re-implement"): the only arithmetic in the job is Σ of bonus per faction; everything else is the rules package. `applyWeeklyCap` over raw metres keeps one implementation of the cap even if a stored value drifted.

**Alternatives rejected**: trusting `capped_meters` blindly (fine in practice, but then the rules package is not the authority); re-scanning `walk_hex_meters` (003 already aggregated them per week).

## R5. Writes per cell and per batch

**Decision**: per batch, results are accumulated in memory and written with set-based statements: `hex_faction_strength` upsert via `unnest` arrays (`strength`, `last_reckoned_week = W`) and a delete of rows whose faction is absent from the new strengths (dropped below `MIN_TRACKED_STRENGTH`); `hex_state` upsert (insert for first-seen cells with `h3_r8..r5` from `cellToParent` and `geom` from `cellPolygonWkt`, R7; update `owner_faction_id`, `owner_since_week` (= W when flipped to a faction, null when flipped to unclaimed, unchanged otherwise), `captain_user_id`, `last_reckoned_week = W`, `last_activity_week = W` when the cell had contributions, `version = version + 1`); `hex_ownership_events` insert per flip (`cause = 'reckoning'`, `at = now`); `hex_reckoning_history` insert per processed cell (`owner`, `strengths` jsonb, `flipped`, `from`, `to`, `captain`); `points_ledger` insert per flip beneficiary (`kind = 'hex_flip'`, `points = HEX_FLIP_XP`, `ref_type = 'hex_ownership_event'`, `ref_id = event id`, `h3_r9`, `week_id`, `faction_id = to`) guarded by the partial unique index `(user_id, ref_id) WHERE kind = 'hex_flip'` with `ON CONFLICT DO NOTHING`, plus `UPDATE users SET xp = xp + 15 × n` grouped per user; parent deltas (R6); finally `UPDATE reckonings SET cursor_h3_r9 = lastCell, batches = batches + 1, hexes_processed = …, flips = …`. All in one transaction.

**Rationale**: 10 000 cells < 5 min (SC-003) needs set-based writes; per-row statements would cost ~10 round trips per cell.

**Alternatives rejected**: Drizzle per-row `insert().onConflictDoUpdate()` loops (simple, too slow at 10 k); `COPY` (no upsert).

## R6. Parents: delta counts and the shared rule over counts

**Decision**: `hex_parent_state.child_owner_counts` is `{ "<factionId>": <claimed children owned by it> }` and `claimed_children` = Σ counts. Per batch the job accumulates, for every flip `from → to` and every level 8–5, `delta[parent][from] -= 1` (when `from ≠ null`) and `delta[parent][to] += 1` (when `to ≠ null`). After the batch it loads the affected parent rows `FOR UPDATE`, applies the deltas (a negative count throws `ParentCountError` and aborts the batch — FR-006), derives the owner with `ownerFromCounts(counts) = deriveParentOwner(expand(counts))` where `expand` repeats each faction id `count` times (order irrelevant), and upserts the rows (creating missing ones with `res` and `geom` from R7). The nightly `reckoning.consistency` job recomputes `counts`/`claimed_children`/owner for every parent from `hex_state` grouped by `h3_r8..r5` (index-only), compares with the stored rows (missing row with claimed > 0, extra row with claimed > 0 but no children, differing owner or counts), writes a `reckoning_consistency` row `{ parents_checked, drifted, repaired, sample (≤ 20 diffs) }`, logs at `error` level when `drifted > 0`, and upserts the recomputed rows only with `repair: true`.

**Rationale**: `docs/territory-rules.md` "Parent ownership"; expanding counts into an array keeps `deriveParentOwner` the single implementation of the rule (Constitution II) at negligible cost (≤ 2 401 entries at res 5).

**Alternatives rejected**: recomputing every parent at every reckoning (10 000 cells → fine today, but the incremental path is what the doc prescribes and is O(flips)); storing parents in a materialised view (needs full refresh; no incremental).

## R7. Geometry without h3-pg

**Decision**: `apps/api/src/lib/h3.ts` gains `parentsOf(cell)` (`cellToParent` for res 8–5), `cellPolygonWkt(cell)` (`cellToBoundary(cell, true)` → longitudes unwrapped to lie within ±180° of the cell centre's longitude, ring closed, `POLYGON((lon lat, …))` in WGS84) and `cellAreaKm2(res)` (h3-js `getHexagonAreaAvg(res, 'km2')`). Rows are inserted with `ST_GeomFromText(wkt, 4326)`; the bbox query uses `geom && ST_MakeEnvelope(minLon, minLat, maxLon, maxLat, 4326)` (GiST). `h3-js` ^4.5 becomes a direct dependency of `@nature/api`.

**Rationale**: Constitution "Technology Constraints" (schema never depends on h3-pg); the fixture's antimeridian cells (`890d9100ad7ffff`) and the pentagon are the tests. Unwrapping keeps a valid polygon for `&&`; cells at ±180° are still returned for boxes on either side because the bbox query is refused when it crosses the antimeridian (R9) and PostGIS compares plain coordinates.

**Alternatives rejected**: `ST_Split` at the antimeridian (complex, no need); storing `geography` (bbox `&&` on geography is slower and the map works in degrees).

## R8. The shared pressure read model

**Decision**: `modules/territory/pressure.ts` exports `pressureScores(db, cells: bigint[], weekId)` → `Map<cell, { scores: Map<factionId, number>, leader: number | null }>` computed by one query (`hex_faction_strength` × `RULES.DECAY` summed with `hex_week_contribution` `capped_meters + capture_bonus_m` for `week_id = W`, grouped by cell and faction) and the pure `leaderOf(scores)` (highest score, ties → lowest faction id, null when all 0). `contested = leader !== null && leader !== owner`. 003's `modules/walks/standing.ts` (`weekStanding`) is refactored to call `pressureScores` for its cells and derive `myFactionShare` from the same scores; a unit test asserts both paths give the same leader for the same rows.

**Rationale**: `docs/territory-rules.md` "Between reckonings"; the binding decision says one helper shared with 003's `weekStanding`; batching by cells is what the list endpoint needs (3 000 cells in one query).

**Alternatives rejected**: a SQL view (fine, but the tie rule and "null when all 0" are easier to test in TypeScript); computing `contested` at reckoning time and storing it (stale within minutes of the first Monday walk).

## R9. `GET /v1/hexes`: bbox validation and cap

**Decision**: query `res` (integer 5–9) and `bbox` (`minLon,minLat,maxLon,maxLat`, four finite numbers). Validation (400 `VALIDATION_FAILED`, `details.field = 'bbox' | 'res'`): lon in [−180, 180], lat in [−90, 90], `minLon < maxLon`, `minLat < maxLat` (so a box may not cross the antimeridian). Cap: `estimatedCells = bboxAreaKm2 / cellAreaKm2(res)` where `bboxAreaKm2 = R² × |sin(maxLat) − sin(minLat)| × (maxLon − minLon in rad)` with `R = EARTH_RADIUS_M / 1000`; `estimatedCells > HEX_BBOX_MAX_CELLS` (3 000) → 400 `BBOX_TOO_LARGE` `{ res, maxCells, estimatedCells }`. Query: res 9 → `hex_state` rows whose `geom && envelope`, joined with `pressureScores` for those cells; res 5–8 → `hex_parent_state WHERE res = ? AND geom && envelope` with `pressureLeader = null`, `contested = false`, `ownerSince = null`. Hard `LIMIT 3 000` after the cap (a rounding guard), sorted by `h3`. Response `{ weekId, items }`. Auth required; `@fastify/rate-limit` 120 requests / minute per user; `Cache-Control: private, max-age=30`.

**Rationale**: FR-010; the client polyfill cap is 3 000 (`docs/architecture.md` §4), so the server never returns more than the client would draw. A spherical-cap area formula is exact for a lon/lat box.

**Alternatives rejected**: polyfilling the box server-side with `polygonToCells` and querying by ids (does the same work twice); returning unclaimed never-seen cells (the client draws nothing for them anyway).

## R10. `GET /v1/hexes/{h3}` shape and the player's states

**Decision**: path `h3` must be a 15-char lowercase hex string of resolution 9 (`getResolution(cell) === 9 && isValidCell`), otherwise 400 `VALIDATION_FAILED` (`details.field = 'h3'`). The service reads `hex_state` (may be absent → empty state), `hex_faction_strength`, the `pressureScores` for the current week (`weekIdFor(now)`), the caller's `hex_week_contribution` row(s) for the cell this week (`meters`, `capped_meters`), the captain's `display_name`, the last 8 `hex_reckoning_history` rows ordered by `week_id desc`, and the player states: `explored` = any `hex_week_contribution` row for (cell, user) any week; `flipped` = any `points_ledger` row `kind = 'hex_flip'` for (user, cell); `held` = `captain_user_id = user`. `captures: []` (006 fills it). One round trip per read is not required; 5 small indexed queries are fine (p95 < 50 ms).

**Rationale**: FR-012 and "Player-facing states" of `docs/territory-rules.md`.

**Alternatives rejected**: 404 for never-walked cells (the map lets you long-press any cell; empty state is the truthful answer).

## R11. `GET /v1/reckonings/latest`

**Decision**: latest = the `reckonings` row with `status = 'done'` and the greatest `week_id` (text order equals chronological order for `YYYY-Www`). Response `{ weekId, ranAt (finished_at), nextAt: nextReckoningAt(now), inProgress: weekId | null (a running row), factionTotals: [...faction_stats_weekly for weekId joined with flips gained/lost counted from hex_ownership_events], myFlips: count(points_ledger hex_flip rows of the caller for weekId), myFlippedHexes: their h3 strings (≤ 200) }`. No reckoning yet → `weekId: null, ranAt: null, factionTotals: [], myFlips: 0, myFlippedHexes: []`, `nextAt` still set. `Cache-Control: private, max-age=60`.

**Rationale**: FR-013; `factionTotals` come from the snapshot so the answer is O(1) after the reckoning; flips gained/lost are two indexed counts on `hex_ownership_events(week_id)`.

**Alternatives rejected**: 404 before the first reckoning (forces the client to special-case an error for a normal state).

## R12. Admin endpoint and role guard

**Decision**: `modules/admin/guard.ts` exports `requireRole(role)` → a `preHandler` that runs after `fastify.authenticate` and throws 403 `FORBIDDEN` when `request.user.role !== role`. `POST /v1/admin/reckonings/{weekId}` body `{ dryRun?: boolean = false, sync?: boolean = false }`: validates the week id format (`^\d{4}-W\d{2}$`, 400), `isCompleted(weekId, now)` (400 `WEEK_NOT_ENDED` with `details.endsAt`), sequence (409 `RECKONING_OUT_OF_ORDER`, R2) and lock (409 `RECKONING_RUNNING`, R3). `sync: true` → runs `runReckoning` in the request and answers 200 `ReckoningRunResult`; `sync: false` → `boss.send('reckoning.weekly', { weekId }, { singletonKey: 'reckoning.weekly' })` and 202 `ReckoningQueued { weekId, jobId }` (503 `JOBS_DISABLED` when `boss` is null). `dryRun` with `sync: false` is rejected (400 `VALIDATION_FAILED`, a dry run has nowhere to report). `GET /v1/admin/reckonings/{weekId}` → 200 `ReckoningStatus` from the row or 404 `RECKONING_NOT_FOUND`. Tag `admin`; both routes require `bearerAuth` and role `admin`.

**Rationale**: FR-014; the synchronous path is what tests and `walk-sim` need (deterministic, result in hand); production runs by job. Sync is documented as "development and test datasets; no request timeout is added — use the job for production sizes".

**Alternatives rejected**: only async + polling (walk-sim would need a poll loop for a 2-second operation); a separate "preview" endpoint (dry run is a flag on the same code path, guaranteeing the preview and the run agree).

## R13. Dry run semantics

**Decision**: `dryRun: true` runs stage `cells` over a read-only snapshot (`REPEATABLE READ` transaction, no writes, no cursor, no `reckonings` row) with the same batch loop and the same pure calls; it skips stage `walks` (would write), notes `staleWalksSkipped: n` in the result, and returns `flips: [{ h3, from, to }]` (≤ 1 000 entries, `flipCount` for the total) plus `parentFlips` computed on in-memory copies of the parent counts. It does not take the advisory lock (a real run may proceed concurrently; the preview is then simply stale).

**Rationale**: FR-014/FR-015 ("`--dry-run` printing flips") without any risk of writing.

## R14. Rollup stage: leaderboards and faction stats

**Decision**: in one transaction: `DELETE FROM leaderboard_snapshots WHERE week_id = W AND scope IN ('global','faction')`; insert the top `LEADERBOARD_TOP_N` (100) players by `meters = Σ capped_meters` over `hex_week_contribution` for W (ties → `user_id` asc) for scope `global` (`scope_id = ''`) and per faction (`scope_id = String(factionId)`, players ranked by the metres they earned **for that faction**), with `points = Σ points_ledger.points WHERE user_id AND week_id = W` (all kinds); `DELETE FROM faction_stats_weekly WHERE week_id = W` then insert per faction `hexes_owned_r9 = count(hex_state owner = f)`, `hexes_owned_r7 = count(hex_parent_state res 7 owner = f)`, `meters = Σ capped_meters for W`, `active_users = count(distinct user_id) for W`, `captures = count(captures WHERE week_id = W AND status = 'verified' AND faction_id = f)` (0 until 006). Scope `hex_r7` is 008's.

**Rationale**: FR-007; delete-then-insert per week makes the stage idempotent and resumable; capped metres are "the metres that counted", which is what a faction leaderboard should rank.

**Alternatives rejected**: raw metres (rewards walking the same cell past the cap); ranking by points (mixes captures in; 008 can add a points board).

## R15. Push stage: queue rows only

**Decision**: `registerJobs` creates the `push.send` queue (no worker until 008). Stage `push` sends, for every user with a `hex_week_contribution` row for W, `boss.send('push.send', { kind: 'reckoning_result', userId, weekId, flips, lost }, { singletonKey: 'reckoning:' + weekId + ':' + userId, expireInHours: 24, retentionDays: 14 })` where `flips` = the user's `hex_flip` ledger rows for W and `lost` = cells the user captained before the run whose owner flipped away (captured in stage `cells` into a per-user tally kept in the `reckonings` row... no: computed after the fact as `count(hex_reckoning_history WHERE week_id = W AND flipped AND captain_before = user)` — so the history row also stores `captain_before_user_id`). A count is written to `reckonings.push_queued`. When `boss` is null (jobs disabled, CLI) the stage logs and skips. Pushes are sent with `startAfter = week end + 8 h` (08:00 UTC Monday); 008 replaces this with the player's local morning.

**Rationale**: FR-008 and the binding decision ("write the queue rows only"); `singletonKey` gives idempotency per player and week; `retentionDays` lets unconsumed rows expire.

**Alternatives rejected**: a `push_outbox` table (a second queue next to pg-boss; 008 would migrate it); no queue at all (loses the Monday message for the week 008 ships).

## R16. Job registration, runner and schedules

**Decision**: `jobs/reckoning-weekly.ts` keeps `RECKONING_WEEKLY`, `RECKONING_CRON = RULES.RECKONING_CRON`, `RECKONING_TZ = RULES.TZ` and `registerReckoningWeekly(boss, log, deps)`; the worker calls `runDueReckonings(deps, clock.now())` when `job.data.weekId` is absent and `runReckoning(deps, { weekId })` otherwise; the schedule is `boss.schedule(RECKONING_WEEKLY, RECKONING_CRON, {}, { tz: 'UTC', singletonKey: 'reckoning.weekly' })`. New `jobs/reckoning-consistency.ts`: `RECKONING_CONSISTENCY = 'reckoning.consistency'`, cron `RECKONING_CONSISTENCY_CRON = '15 3 * * *'` UTC, singleton, handler `runConsistency(deps, { repair: false })`. `registerJobs` also runs `runDueReckonings` once on start-up (catch-up, R2) when jobs are enabled. `jobs/run.ts` parses `--week <id>`, `--dry-run`, `--repair`: `job:reckoning` without `--week` → `runDueReckonings`; with `--week` → `runReckoning`; `--dry-run` prints one line per flip (`h3 from→to`) then the JSON result; `job:consistency` → `runConsistency({ repair })`. Exit codes as before (0 / 1 / 2).

**Rationale**: FR-001/FR-015/FR-016; keeps 001's skeleton names so the existing unit tests only need extending.

## R17. Purge and export registration

**Decision**: `modules/territory/purge.ts` exports two 002 `PurgeStep`s: `leaderboard_snapshots` (replaces 002's delete step in `PURGE_STEPS` at the same position: `UPDATE leaderboard_snapshots SET user_id = NULL WHERE user_id = $1`) and `territory` (tables `hex_reckoning_history`, `pgboss.job`: `UPDATE hex_reckoning_history SET captain_user_id = NULL, captain_before_user_id = NULL WHERE … = $1`; `DELETE FROM pgboss.job WHERE name = 'push.send' AND state IN ('created','retry') AND data->>'userId' = $1` guarded by `to_regclass('pgboss.job') IS NOT NULL`). `hex_state.captain_user_id` is `ON DELETE SET NULL` (001) and `hex_ownership_events` has no user column (nothing to do — "keep with null user"). `modules/territory/export-section.ts` adds section `territory`: `{ flips: [{ h3, weekId, xp }], captainOf: [h3], leaderboard: [{ weekId, scope, scopeId, rank, meters, points }] }`. Migration: `leaderboard_snapshots.user_id DROP NOT NULL`, `hex_reckoning_history.captain_user_id/captain_before_user_id ON DELETE SET NULL`.

**Rationale**: FR-017, Constitution IV, the binding decision (anonymise snapshots, keep events).

**Alternatives rejected**: deleting snapshot rows (boards get holes and ranks stop matching).

## R18. Constants of this feature

**Decision**: `modules/territory/limits.ts`: `HEX_FLIP_XP = 15`, `RECKONING_BATCH_SIZE = 1000`, `HEX_BBOX_MAX_CELLS = 3000`, `LEADERBOARD_TOP_N = 100`, `HEX_HISTORY_WEEKS = 8`, `RECKONING_CONSISTENCY_CRON = '15 3 * * *'`, `HEXES_RATE_PER_MIN = 120`, `RECKONING_LOCK_KEY = 0x6e617475` (arbitrary, documented), `PUSH_START_AFTER_H = 8`. Env overrides (`data-model.md` §7): `RECKONING_BATCH_SIZE`, `HEX_BBOX_MAX_CELLS`, `RECKONING_CONSISTENCY_CRON`. A unit test asserts `docs/territory-rules.md` contains "hex-flip XP (+15)" and "last 8 reckonings" (the same doc-consistency mechanism as 002/003). Territory constants (`DECAY`, `MIN_STRENGTH_M`, `HYSTERESIS`, `PARENT_*`, `RECKONING_CRON`, `TZ`) are read from `RULES` only.

**Rationale**: FR-020, Constitution II and "Development Workflow": the flip XP is a game constant the client never evaluates and no fixture consumes; adding it to the "Constants summary" would force fixtures → TS → Swift → doc for nothing.

## R19. Tests: fixture replay, crash injection, performance

**Decision**: `test/helpers/reckoning.ts` seeds users (fixture `u1…` → real users with the faction of their first contribution; one synthetic "bonus" user per faction for `bonuses`), initial state (`hex_faction_strength`, `hex_state` with `last_reckoned_week = '2026-W34'`), contributions per week (`meters` raw, `capped_meters = min`, `capture_bonus_m` on the bonus user's row), and exposes `runFixtureWeek(app, weekId)` with a `FakeClock` set to the Monday after. `deps.hooks?.afterBatch(n)` (test-only) throws after batch 1 to simulate a crash (batch size 3 in that test), then the run is repeated and every 004 table is compared row-for-row with a clean run on a second database. The perf test builds `gridDisk(centre, 58)` (10 267 cells) with two factions' strengths and three users' contributions, runs one reckoning with the real batch size and asserts `< 300 000 ms`, logging the duration; skipped with `SKIP_PERF=1` or when the DB is skipped.

**Rationale**: FR-019, SC-001–SC-003, Constitution V.

## R20. Environment facts for implementers

Agent containers: Node 22 + pnpm; local Postgres 16 + PostGIS at `postgres://nature:nature@localhost:5432/nature` (superuser; `createTestDatabase` clones per suite); **no h3-pg** (migration `0005` must not reference the extension or any `h3_*` SQL function; every H3 computation happens in `h3-js`); no Docker; no Swift needed (no iOS work). 003 is being implemented concurrently: Stream A of 004 starts after 003's Stream A is merged (both edit `apps/api/src/modules/me/purge.ts`, `src/jobs/{index,run}.ts`, `src/app.ts`, `src/plugins/openapi.ts`, `src/errors.ts`, `src/config.ts`, `drizzle/`); until then it codes against 003's contract (`plan.md` "Dependencies on 003"). Migration number: `0005_reckoning.sql` (0004 is 003's); renumber if 003 adds another.
