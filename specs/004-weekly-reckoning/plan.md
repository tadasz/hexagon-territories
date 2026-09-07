# Implementation Plan: Weekly Reckoning

**Branch**: `004-weekly-reckoning` | **Date**: 2026-09-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-weekly-reckoning/spec.md`

**Note**: This plan references `docs/architecture.md` (§5 backend: modules, jobs incl. `reckoning.weekly` and `parent.recompute`, the `/v1/hexes*` and `/v1/reckonings/latest` endpoints; §6 data model; §8 "Weekly cadence") and `docs/territory-rules.md` ("Weekly reckoning", "Between reckonings", "Parent ownership", "Player-facing states", "Constants summary") instead of restating them. Deviations are listed under **Deviations** and justified. Feature 001's artefacts (Fastify `buildApp`, error envelope, `db`/`jobs`/`openapi` plugins, the Drizzle schema for `hex_*`, `reckonings`, `points_ledger`, `leaderboard_snapshots`, `faction_stats_weekly`, the `reckoning.weekly` skeleton in `src/jobs/reckoning-weekly.ts`, the test database helper), feature 002's (`auth` plugin with `request.user.role`, `rate-limit` plugin, purge and export registries, `registerJobs`, `@nature/api-schema` snapshot, `FakeClock`) and feature 003's (`finishWalk`, `walk.autofinish`, `hex_week_contribution` writes, `weekStanding`, `lib/h3.ts`, `lib/geo.ts`, `@nature/walk-sim`) are reused, not repeated. 003 is being implemented concurrently: this plan targets its **contract** (`specs/003-walk-tracking/{plan,data-model}.md`, `contracts/openapi.yaml`, `tasks.md`), not its final code; where a 003 name is assumed it is listed in "Dependencies on 003".

## Summary

Make `reckoning.weekly` real: a singleton, resumable pg-boss job that, for the ISO week that just ended, auto-finishes stale walks, then in batches of 1 000 cells applies decay, adds the week's capped metres and bonuses, decides owners with hysteresis, names captains, records flips and history, awards flip XP, updates parents incrementally, snapshots leaderboards and faction statistics, records the run and queues result pushes — calling `applyWeeklyCap`, `reckonWeek`, `deriveParentOwner` and `weekIdFor` from `@nature/territory-rules` for every rule (R1–R6, R14–R16). Add the read model the map needs (`GET /v1/hexes`, `GET /v1/hexes/{h3}`, `GET /v1/reckonings/latest`; the shared pressure/contested helper, R8–R11), admin/ops entry points (`POST/GET /v1/admin/reckonings/{weekId}` with dry run, the job runner's `--week`/`--dry-run`, `walk-sim reckon`, R12–R13), the nightly `reckoning.consistency` job (R6), purge/export registration (R17), migration `0005`, integration tests over the `reckoning-weeks.json` fixture semantics plus resume, idempotency, cap errors, drift and a timed 10 000-cell run (R19), and a refreshed OpenAPI snapshot for 005. No iOS work. Two streams: **A api** (everything above) and **B integration** (root, docs, CI, analyze + converge).

## Technical Context

**Language/Version**: TypeScript 5.9 on Node 22 (`apps/api`, `packages/walk-sim`, `packages/api-schema`); SQL (Drizzle migration `0005_reckoning.sql`).

**Primary Dependencies**: existing 001–003 stack (Fastify 5, TypeBox, `@fastify/swagger`, `@fastify/rate-limit`, Drizzle 0.44, `pg`, pg-boss 10, Vitest 3, `@nature/territory-rules`, `@nature/h3-fixtures`, `@nature/walk-sim`, `commander`) plus **new direct dependency** `h3-js` ^4.5 in `@nature/api` (already a transitive dependency via the rules package; used directly for `cellToParent`, `cellToBoundary`, `getResolution`, `isValidCell`, `getHexagonAreaAvg`, `gridDisk` in tests). No new libraries otherwise.

**Storage**: Postgres 16 + PostGIS (001 image): existing `hex_week_contribution` (read), `hex_faction_strength`, `hex_state`, `hex_ownership_events`, `hex_parent_state`, `reckonings`, `points_ledger`, `users.xp`, `leaderboard_snapshots`, `faction_stats_weekly`, `captures` (count only), `walk_sessions` (via 003's autofinish); **new** table `hex_reckoning_history`, table `reckoning_consistency`, columns on `reckonings` (`stage`, `cursor_h3_r9`, `batches`, `parent_flips`, `walks_autofinished`, `push_queued`, `error`, `attempt`), `leaderboard_snapshots.user_id` nullable, partial unique index on `points_ledger` for flip XP (`data-model.md` §1). pg-boss queue `push.send` (rows only). No h3-pg.

**Testing**: Vitest unit tests (weeks helpers, `leaderOf`, bbox area/cap, `cellPolygonWkt` on the fixture's antimeridian/pentagon cells, `ownerFromCounts` vs `deriveParentOwner` on the fixture's `parentCases`, limits doc-consistency, schemas, `run.ts` argument parsing) and integration tests against the real Postgres via `DATABASE_URL` (skipped with `SKIP_DB_TESTS=1`): fixture replay over three weeks, idempotent rerun, resume after injected crash, first-time cell creation (parents + `ST_Contains(geom, centre)`), list endpoint at res 5–9 with cap errors, contested flag, hex detail, latest + `myFlips`, admin endpoint (403, sequence, not-ended, running, dry run), pushes queued once, consistency drift/repair, purge/export, catch-up of missed weeks, perf (`SKIP_PERF=1` to skip). `walk-sim` unit test for the `reckon` command against a fake fetch. `python3 -m unittest` and Swift unchanged.

**Target Platform**: Linux server (API, Compose). Agent containers: Node 22 + pnpm, local Postgres 16 + PostGIS (no h3-pg), no Docker, no Swift needed (R20).

**Project Type**: Monorepo: API + shared packages + CLI (no mobile work in this feature).

**Performance Goals**: reckoning of 10 000 cells < 5 min (SC-003; design target < 60 s: set-based writes per batch, R5); `GET /v1/hexes` 3 000 cells < 300 ms p95 (SC-004; GiST bbox + one grouped pressure query, R8/R9); `GET /v1/hexes/{h3}` < 50 ms p95; `GET /v1/reckonings/latest` < 50 ms p95 (snapshot reads, R11).

**Constraints**: ownership changes only inside `reckoning.weekly` (Constitution II); every rule via the rules package (no re-implementation); no h3-pg; single API instance (in-memory rate limits as accepted in 002); no PostHog; no iOS changes; no rule/constant change (fixtures untouched); 003's `finishWalk` is the only scoring path and is not modified here (only called); `hex_week_contribution` is never written by 004.

**Scale/Scope**: 5 new operations (3 player, 2 admin), 2 jobs (one made real, one new), 1 migration, 1 `walk-sim` subcommand, 0 new packages, ≤ 10 000 cells and ≤ 10 000 players per week in the beta.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this feature complies |
|---|---|---|
| I. Server-authoritative game state | PASS | Every input is data the server wrote itself in 003 (`hex_week_contribution`) or in earlier reckonings; no client value enters the job. Read endpoints expose results, never accept them. The admin endpoint accepts only a week id and flags. |
| II. One place for each rule | PASS | The job calls `applyWeeklyCap`, `reckonWeek`, `deriveParentOwner` (via `ownerFromCounts`, R6), `weekIdFor`, `RULES.DECAY/RECKONING_CRON/TZ`; the pressure read model uses `RULES.DECAY` (R8). No constant is duplicated; fixtures, rules packages, the Swift mirror and the "Constants summary" are untouched (FR-020). `hex_state.owner_faction_id` is written only by stage `cells` of `runReckoning` (and by the consistency job only for **parent** rows, only with `--repair`). Non-territory constants (flip XP, batch size, caps) follow the 002/003 `limits.ts` + doc-consistency-test pattern (R18, Deviations). |
| III. Licence before ship | PASS | No model, dataset, tile source or species image. `h3-js` (Apache-2.0) is already a dependency of the rules package and is listed in `docs/licences.md` by 001 (Stream B verifies the row covers the API). |
| IV. Privacy by default | PASS | New per-player rows (leaderboard snapshots, flip XP, history captain references, queued pushes) are registered with the purge registry (anonymise / clear / delete, R17) and the export gains a `territory` section; the FK-coverage test enforces registration. The read endpoints expose aggregated metres per faction and the caller's own metres only; captains are shown by display name (a public game role). No analytics. |
| V. Test at the layer you touch | PASS | Unit tests for pure helpers; integration tests against the real Postgres for the job, endpoints, jobs, purge/export, including fixture parity (SC-001), crash resume (SC-002) and a timed run (SC-003); `quickstart.md` is executable per stream. |
| VI. Small, mergeable steps | PASS | 22 tasks in two streams with disjoint paths; each task is one PR with an acceptance check. Deferred on purpose: push delivery and devices (008), MVT tiles (008), `hex_r7` leaderboards (008), parent pressure/contested (005/008 follow-up), history retention (later), the iOS map (005). |
| VII. Battery and offline are features | PASS (N/A) | Server-only feature; the read endpoints are small and cacheable (`Cache-Control: private`) so the map polls cheaply. |
| Workflow: plan references architecture docs | PASS | This file links `docs/architecture.md` §5/§6/§8 and `docs/territory-rules.md`; deviations listed below. |
| Workflow: contracts as OpenAPI fragments, merged into `packages/api-schema`, iOS client generated | PASS | `contracts/openapi.yaml` is the reviewed fragment; Stream A refreshes `packages/api-schema/openapi.json`; 005 generates the client from it (FR-018, SC-008). |
| Workflow: tunable constants only via `territory-rules.md` + `config.ts` | PASS | None changed; feature constants in `modules/territory/limits.ts` with a doc-consistency test (R18). |

**Post-design re-check (after Phase 1)**: no new violations. Structural additions beyond `docs/architecture.md` §3/§6: module directory `apps/api/src/modules/territory/` (§5 names the `territory` module — "reckoning, hex reads, tiles"), `apps/api/src/modules/admin/guard.ts` (§5 names an `admin` module), tables `hex_reckoning_history` and `reckoning_consistency` (Deviations).

## Project Structure

### Documentation (this feature)

```text
specs/004-weekly-reckoning/
├── spec.md              # Feature spec with Clarifications
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R20
├── data-model.md        # Phase 1: migration, API shapes, job payloads, walk-sim shapes, config
├── quickstart.md        # Phase 1: how to verify each stream and the whole feature
├── checklists/requirements.md
├── contracts/
│   └── openapi.yaml     # Phase 1: /v1/hexes, /v1/hexes/{h3}, /v1/reckonings/latest, /v1/admin/reckonings/{weekId} (reviewed fragment)
└── tasks.md             # Phase 2: streams A–B
```

### Source Code (repository root)

Files created or changed by this feature, with the owning stream (`tasks.md` "Stream ownership"). Everything not listed stays as 001–003 left it.

```text
apps/api/                                        # Stream A
  package.json                                   # + dependency h3-js ^4.5; scripts job:reckoning (now `tsx src/jobs/run.ts reckoning.weekly`, accepts -- --week/--dry-run), job:consistency
  .env.example                                   # + RECKONING_BATCH_SIZE, HEX_BBOX_MAX_CELLS, RECKONING_CONSISTENCY_CRON
  src/config.ts                                  # + territory group (data-model.md §7)
  src/errors.ts                                  # + BBOX_TOO_LARGE, WEEK_NOT_ENDED, RECKONING_OUT_OF_ORDER, RECKONING_RUNNING, RECKONING_NOT_FOUND, JOBS_DISABLED
  src/app.ts                                     # registers territoryRoutes, adminReckoningRoutes
  src/plugins/openapi.ts                         # + the territory/admin component schemas
  src/plugins/jobs.ts                            # deps for reckoning (batch size, hooks); start-up catch-up
  src/db/schema/hexes.ts                         # + hexReckoningHistory, reckoningConsistency; reckonings columns
  src/db/schema/game.ts                          # leaderboard_snapshots.user_id nullable
  drizzle/0005_reckoning.sql, drizzle/meta/*     # migration + journal/snapshot
  src/lib/h3.ts                                  # + parentsOf, cellPolygonWkt, cellAreaKm2, isRes9Cell (h3-js)
  src/lib/geo.ts                                 # + bboxAreaKm2, parseBbox, envelopeSql
  src/modules/territory/
    limits.ts                                    # HEX_FLIP_XP, RECKONING_BATCH_SIZE, HEX_BBOX_MAX_CELLS, LEADERBOARD_TOP_N, HEX_HISTORY_WEEKS, RECKONING_CONSISTENCY_CRON, HEXES_RATE_PER_MIN, RECKONING_LOCK_KEY, PUSH_START_AFTER_H
    weeks.ts                                     # justEndedWeek, nextWeekId, previousWeekId, weekEndUtc, isCompleted, nextReckoningAt
    pressure.ts                                  # pressureScores(db, cells, weekId), leaderOf(scores), contestedFor(owner, leader)
    schemas.ts                                   # TypeBox: HexListItem, HexList, HexDetail(+parts), ReckoningLatest, FactionTotal, ReckoningRunRequest, ReckoningRunResult, FlipPreview, ReckoningQueued, ReckoningStatus
    hexes.ts                                     # listHexes(db, {res, bbox, weekId}), getHexDetail(db, cell, weekId, me)
    latest.ts                                    # latestReckoning(db, now, me)
    routes.ts                                    # GET /v1/hexes, GET /v1/hexes/{h3}, GET /v1/reckonings/latest
    admin-routes.ts                              # POST/GET /v1/admin/reckonings/{weekId}
    purge.ts                                     # PurgeSteps leaderboard_snapshots (anonymise), territory (history refs, queued pushes)
    export-section.ts                            # ExportSection territory
    reckoning/
      run.ts                                     # runReckoning(deps, {weekId, dryRun}), runDueReckonings(deps, now), ReckoningDeps, errors, advisory lock
      cells.ts                                   # selectCellBatch, loadBatchInputs, reckonBatch (applyWeeklyCap + reckonWeek per cell) → BatchResult
      writes.ts                                  # writeBatch(tx, W, result): strength/state/events/history/ledger/xp/cursor (set-based)
      parents.ts                                 # ParentDelta, applyParentDeltas(tx, deltas), ownerFromCounts(counts), recomputeParents(db, {repair})
      rollup.ts                                  # snapshotLeaderboards(tx, W), snapshotFactionStats(tx, W)
      push.ts                                    # enqueueResultPushes(boss, db, W)
  src/modules/admin/guard.ts                     # requireRole('admin')
  src/modules/walks/standing.ts                  # (003) refactored to call pressure.ts — after 003 merges (T012)
  src/jobs/reckoning-weekly.ts                   # real handler + deps
  src/jobs/reckoning-consistency.ts              # new job
  src/jobs/index.ts                              # registers both, creates push.send, start-up catch-up
  src/jobs/run.ts                                # --week, --dry-run, --repair; job:consistency
  test/helpers/reckoning.ts                      # fixture seeding, runFixtureWeek, tableSnapshot (row-for-row compare), gridSeed(n)
  test/unit/{territory-weeks,territory-pressure,territory-bbox,h3-geometry,territory-parents,territory-limits,territory-schemas,jobs-run-args,reckoning-weekly}.test.ts
  test/integration/{reckoning-fixture,reckoning-resume,reckoning-catchup,hexes-list,hexes-detail,reckonings-latest,admin-reckonings,reckoning-push,reckoning-consistency,territory-purge-export,reckoning-perf,schema}.test.ts

packages/walk-sim/                               # Stream A — @nature/walk-sim
  src/reckon.ts                                  # reckon({baseUrl, token, weekId, dryRun, sync, fetch}) → ReckoningRunResult | ReckoningQueued
  src/cli.ts                                     # + subcommand `reckon <weekId> --base-url --token [--dry-run] [--async] [--json]`
  src/api-types.ts                               # + ReckoningRunResult, FlipPreview, ReckoningQueued (mirrors)
  test/reckon.test.ts
  README.md                                      # reckon usage

packages/api-schema/openapi.json                 # Stream A — snapshot refreshed (`pnpm --filter @nature/api-schema snapshot`)

Root / docs (Stream B only): pnpm-lock.yaml (h3-js hoisting), turbo.json (passthrough RECKONING_*/HEX_*/SKIP_PERF), README.md, CLAUDE.md (commands), docs/architecture.md §5/§6 (admin endpoints, consistency job, push.send stub, new tables/columns, parent pressure note), docs/territory-rules.md (wording only, no constants), docs/roadmap.md (004 status / 008 note on push delivery & parent pressure), docs/licences.md (verify h3-js row), .github/workflows/api.yml (SKIP_PERF, timeouts), specs/004-weekly-reckoning/{quickstart.md log, analysis.md, tasks.md}
```

**Structure Decision**: Extends the 001–003 monorepo per `docs/architecture.md` §3; the `territory` module of §5 gets its directory with a `reckoning/` sub-folder (six files, each one stage or concern) so the job stays reviewable; no new packages or top-level directories.

## Package, Target and Name Conventions (use everywhere)

| Thing | Name |
|---|---|
| Fastify modules | `territory` (`/v1/hexes`, `/v1/hexes/{h3}`, `/v1/reckonings/latest`; tag `territory`; `operationId`s `listHexes`, `getHex`, `getLatestReckoning`), `admin` (`/v1/admin/reckonings/{weekId}`; tag `admin`; `runReckoning`, `getReckoning`) |
| Job names | `reckoning.weekly` (cron `RULES.RECKONING_CRON` = `0 0 * * 1`, tz `RULES.TZ` = `UTC`, `singletonKey: 'reckoning.weekly'`), `reckoning.consistency` (cron `15 3 * * *` UTC, singleton), queue `push.send` (created, no worker) |
| Runner scripts | `job:reckoning -- [--week YYYY-Www] [--dry-run]`, `job:consistency -- [--repair]` |
| Entry points | `runReckoning(deps, { weekId, dryRun })`, `runDueReckonings(deps, now)`, `runConsistency(deps, { repair })` |
| Stages (`reckonings.stage`) | `walks` → `cells` → `rollup` → `push` → `done` (`failed` sets `status = 'failed'`, `stage` unchanged, `error` text; a rerun resumes) |
| Constants (`modules/territory/limits.ts`) | `HEX_FLIP_XP = 15`, `RECKONING_BATCH_SIZE = 1000`, `HEX_BBOX_MAX_CELLS = 3000`, `LEADERBOARD_TOP_N = 100`, `HEX_HISTORY_WEEKS = 8`, `RECKONING_CONSISTENCY_CRON = '15 3 * * *'`, `HEXES_RATE_PER_MIN = 120`, `RECKONING_LOCK_KEY = 1851881589`, `PUSH_START_AFTER_H = 8` |
| Error codes | `BBOX_TOO_LARGE` 400, `WEEK_NOT_ENDED` 400, `RECKONING_OUT_OF_ORDER` 409, `RECKONING_RUNNING` 409, `RECKONING_NOT_FOUND` 404, `JOBS_DISABLED` 503 (+ 002's `FORBIDDEN` 403, `RATE_LIMITED` 429, `VALIDATION_FAILED` 400, `UNAUTHORIZED` 401) |
| Ownership event cause | `'reckoning'` (004); `'admin'` reserved for 008's flag-clearing re-score |
| Ledger | `kind = 'hex_flip'`, `points = 15`, `ref_type = 'hex_ownership_event'`, `ref_id = String(event.id)` |
| Leaderboard scopes | `global` (`scope_id = ''`), `faction` (`scope_id = String(factionId)`); `hex_r7` is 008's |
| Push payload | `{ kind: 'reckoning_result', userId, weekId, flips, lost }`, `singletonKey = 'reckoning:<weekId>:<userId>'` |
| H3 in JSON | 15-char lowercase hex string (`h3`), converted with `lib/h3.ts`; bbox `minLon,minLat,maxLon,maxLat` |
| Week ids | `YYYY-Www` (ISO week, UTC) everywhere; `weekIdFor` from the rules package; helpers in `modules/territory/weeks.ts` |
| walk-sim | subcommand `reckon <weekId>`; library export `reckon(options)`; default `sync: true`, `--async` for 202 |

## Shared Semantics (job, endpoints and CLI must agree)

Defined once here. Types: `data-model.md`; endpoints: `contracts/openapi.yaml`; decisions: `research.md`.

1. **Week under reckoning**: `justEndedWeek(now)` (R2); reckonings are strictly sequential; a done week is a no-op that returns its stored result; a not-ended week is refused; a week older than the last done is a no-op (it is done by definition of the sequence).
2. **Cell set**: `hex_faction_strength` ∪ `hex_week_contribution[W]`, ascending `h3_r9`, batches of `RECKONING_BATCH_SIZE`; a cell with `hex_state.last_reckoned_week = W` is skipped (R4).
3. **Per-cell arithmetic**: `applyWeeklyCap(raw rows) → ReckonContribution[] (with userId)`, bonuses = Σ `capture_bonus_m` per faction, `reckonWeek({ cell, owner, strengths, contributions, bonuses })`; the job stores `result.strengths` (rows absent from it are deleted), `result.owner`, `result.captain`, `result.event` (R4/R5).
4. **`owner_since_week`**: W when `flipped && owner !== null`; null when `flipped && owner === null`; unchanged otherwise.
5. **Flip XP**: for each `event` with `to !== null`, every `ReckonContribution` with `factionId === to && cappedMeters > 0 && userId` gets one `hex_flip` ledger row (idempotent on `(user_id, ref_id)`) and `users.xp += 15` (R5).
6. **Parents**: deltas per level from `event.from/to`; owner = `ownerFromCounts(counts)` = `deriveParentOwner(expand(counts))`; negative count ⇒ batch fails (R6).
7. **Rollup**: delete-then-insert per week for both snapshot tables; leaderboards by Σ `capped_meters`, ties by `user_id` asc, top 100; faction stats as R14.
8. **Push**: one `push.send` row per contributing user, `singletonKey` per (week, user), `flips` = the user's `hex_flip` rows for W, `lost` = count of history rows for W with `flipped` and `captain_before_user_id = user` (R15); skipped with a log line when `boss` is null.
9. **Pressure / contested**: `score(f) = Σ strength(f) × RULES.DECAY + Σ capped_meters(f, W) + Σ capture_bonus_m(f, W)`; `leader = argmax` (ties → lowest faction id; null when all 0); `contested = leader !== null && leader !== owner`; identical in `listHexes`, `getHexDetail` and 003's `weekStanding` (R8).
10. **`GET /v1/hexes` cap**: `estimatedCells = bboxAreaKm2 / cellAreaKm2(res)`; `> HEX_BBOX_MAX_CELLS` ⇒ 400 `BBOX_TOO_LARGE { res, maxCells, estimatedCells }`; box must not cross the antimeridian (R9). Res 5–8 rows: `pressureLeader: null`, `contested: false`, `ownerSince: null`.
11. **Hex detail**: 200 for any valid res-9 cell; empty state when unknown; history newest first, ≤ 8; `captures: []` (R10).
12. **Latest**: last `done` reckoning; nullable week fields before the first; `nextAt = nextReckoningAt(now)` always (R11).
13. **Admin**: role `admin` only; `sync` ⇒ 200 result, else 202 queued; `dryRun` requires `sync`; errors per R12; dry run writes nothing and skips the walks stage (R13).
14. **Consistency**: report always; repair only with `repair: true`; never touches res-9 rows (R6).
15. **Errors**: every non-2xx uses the 001 `Error` envelope.

## Deviations from `docs/architecture.md` / `docs/territory-rules.md` / 001–003

| Deviation | Justification |
|---|---|
| New table `hex_reckoning_history` (§6 has none) | §5's hex detail shows "the last 8 reckonings"; strengths per week cannot be reconstructed from `hex_faction_strength` (current only) or `hex_ownership_events` (flips only). One row per processed cell per week (~10 k/week). Also carries `captain_before_user_id` for the "lost captaincy" push count. |
| New table `reckoning_consistency` | The nightly job must "alert on drift" (§5/`territory-rules.md`); a row per run makes drift visible to an admin page (008) beyond the log line. |
| `reckonings` gains `stage`, `cursor_h3_r9`, `batches`, `parent_flips`, `walks_autofinished`, `push_queued`, `error`, `attempt` | §5 requires "singleton, resumable per cell batch"; the cursor and stage are the resume state (R1). |
| `leaderboard_snapshots.user_id` becomes nullable | Binding decision: anonymise rather than delete on erasure (R17); ranks stay contiguous. |
| Partial unique index `points_ledger (user_id, ref_id) WHERE kind = 'hex_flip'` | Idempotent flip XP under resume (R5). |
| `POST/GET /v1/admin/reckonings/{weekId}` (not in §5's REST block; §5 lists an `admin` module) | Binding decision (chosen over the CLI-only option) so `walk-sim reckon` and testers can trigger a reckoning through the API with role `admin`. |
| `GET /v1/reckonings/latest` adds `inProgress` and `myFlippedHexes`; `factionTotals` adds `flipsGained`/`flipsLost` | Additive fields for 005's results sheet; `myFlips` stays the integer §5 names. |
| `GET /v1/hexes` returns `pressureLeader: null`, `contested: false` for res 5–8 | Computing parent pressure needs every child's score (up to 2 401 children per res-5 cell × 3 000 cells); a materialised parent pressure refreshed by 008's `leaderboard.rollup` (every 10 min) is the follow-up, recorded in `docs/roadmap.md` by Stream B. |
| `push.send` queue created with rows and no worker | Binding decision ("write the queue rows only"); 008 attaches the worker and devices. Rows expire after 14 days (R15). |
| Hex-flip XP (15) in `modules/territory/limits.ts`, not in the "Constants summary" | Same reasoning and mechanism as 002's account rules and 003's XP cap (R18): a game constant the client never evaluates and no fixture consumes; a doc-consistency test keeps `docs/territory-rules.md` ("hex-flip XP (+15)") the documented source. |
| `parent.recompute` (§5: "inside reckoning; nightly full re-derivation") is realised as stage `cells`' parent deltas plus the separate `reckoning.consistency` job | The nightly path is a checker/repairer, not a scheduled rewrite; naming it `consistency` matches the binding decision. Stream B updates §5's wording. |
| Start-up catch-up of missed weeks (`runDueReckonings` on `registerJobs`) | FR-001; pg-boss does not replay missed cron fires; decay must be applied per week (R2). |
| The pressure helper lives in `modules/territory/pressure.ts` and 003's `walks/standing.ts` becomes a caller | Binding decision ("share the helper with 003's `weekStanding`"); the refactor is one task after 003 merges (T012) and preserves 003's response shape. |

## Complexity Tracking

No constitution violations to justify. The staged, cursor-based run (R1) and the set-based batch writes (R5) are the two places where the design is more than the minimum; both are needed for "resumable" and "10 000 cells < 5 min" and are documented with the rejected simpler alternatives.

## Dependencies on 003 (Stream A must wait for these to be merged, or code against their contract)

| 003 artefact | Used by | If not merged yet |
|---|---|---|
| `hex_week_contribution` rows written by `finishWalk` (`meters`, `capped_meters`, `capture_bonus_m`, `walks`) — 003 T006 | stage `cells`, `pressureScores`, rollup, push | The table exists since 001; tests seed rows directly (R19), so the job can be built and tested before 003 lands. |
| `walk.autofinish` sweep — 003 T010 (`apps/api/src/jobs/walk-autofinish.ts`, exported `runWalkAutofinish(deps)` returning `{ finished, failed, walkIds }`) | stage `walks` | Code against the name behind a `deps.autofinish?: () => Promise<{ finished: number }>` injection; when 003's export differs, adapt the wrapper in `run.ts` only. Tests inject a fake. |
| `modules/walks/standing.ts` `weekStanding` / `computeStanding` / `STANDING_STRENGTH_WEIGHT = 0.5` — 003 T006 (present in the working tree) | T012 refactor to `pressure.ts` | Build `pressure.ts` standalone first (T003); in T012 replace `STANDING_STRENGTH_WEIGHT` and the per-cell score query with `pressureScores`/`leaderOf` (which use `RULES.DECAY`), keep `weekStanding`'s signature and response shape; the equality test guards the behaviour. |
| `src/lib/h3.ts` (`cellToBigInt`, `bigIntToCell`), `src/lib/geo.ts` — 003 T001 (already present in the working tree) | everywhere | Present; extend, do not rewrite. |
| `modules/me/purge.ts` `PURGE_STEPS` with 003's `walks` step (replaces 002's plain deletes) — 003 T011 | T013 (replace the `leaderboard_snapshots` step, add `territory`) | Edit the registry after 003's step is in; the FK-coverage test decides. |
| `src/jobs/{index,run}.ts` with 003's `walk.autofinish` / `samples.purge` registrations — 003 T010 | T011 | Same files, merge after 003; keep additions minimal and adjacent. |
| `@nature/walk-sim` CLI (`commander`, `src/cli.ts`, `api-types.ts`) — 003 T003–T004 (present in the working tree) | T015 `reckon` subcommand | Present; add a subcommand and mirror types. |
| Migration `0004_walks.sql` — 003 T002 (present) | `0005_reckoning.sql` numbering | Renumber if 003 adds another migration (R20). |
| `packages/api-schema/openapi.json` with 003's walk operations | T016 snapshot refresh | Refresh after 003 merges so the snapshot contains both; if refreshed earlier, Stream B refreshes again (T018). |

## Owner actions

1. Decide whether the Monday results push should be sent at 08:00 UTC (004 stub default) or the player's local morning (008 default per §8); 004 sets `startAfter = week end + 8 h` and 008 replaces it.
2. Confirm the flip XP (15), the leaderboard size (100) and the map cap (3 000 hexagons per request) before public TestFlight; each is one constant in `limits.ts` and one line in the docs.
3. Create an `admin` user in each environment (`UPDATE users SET role = 'admin' WHERE id = …`) for `walk-sim reckon`; there is no self-service path to the admin role.

## Environment notes for implementation agents

- **Stream A**: Node 22 + pnpm; `DATABASE_URL=postgres://nature:nature@localhost:5432/nature` for the integration suites (no Docker, no h3-pg — never write SQL that needs it); `pnpm --filter @nature/api add h3-js@^4.5` locally, do not hand over `node_modules`, `dist` or a lockfile; tell Stream B. Start after 003's Stream A is merged, or code against the contract table above. Set `SKIP_PERF=1` while iterating; run the perf test once before opening the last PR and record the time in `quickstart.md`.
- **Stream B**: regenerates `pnpm-lock.yaml`, refreshes the snapshot again if 003 merged after A's refresh, edits root files and docs, runs `/speckit-analyze` and `/speckit-converge`.
- Set `export SPECIFY_FEATURE=004-weekly-reckoning SPECIFY_FEATURE_DIRECTORY=specs/004-weekly-reckoning` before any `.specify/scripts/bash/*.sh` script or Spec Kit skill.
