# Quickstart: Weekly Reckoning

**Feature**: `004-weekly-reckoning` | **Date**: 2026-09-07

How a reviewer or agent verifies each stream and then the whole feature (Constitution V). Commands run from the repository root unless stated. Environment facts: `research.md` R20.

```bash
export SPECIFY_FEATURE=004-weekly-reckoning SPECIFY_FEATURE_DIRECTORY=specs/004-weekly-reckoning
export DATABASE_URL=postgres://nature:nature@localhost:5432/nature   # local Postgres 16 + PostGIS; no Docker, no h3-pg
```

## A. Stream A — API and walk-sim

### A.1 Build and unit tests

```bash
pnpm install --frozen-lockfile            # Stream B commits the lockfile; A may `pnpm --filter @nature/api add h3-js@^4.5` locally
pnpm turbo run build --filter=@nature/api... --filter=@nature/walk-sim...
SKIP_DB_TESTS=1 pnpm --filter @nature/api test      # unit: weeks, pressure leader, bbox cap, geometry (antimeridian/pentagon), parents vs deriveParentOwner, limits doc-consistency, schemas, run.ts args
pnpm --filter @nature/walk-sim test                 # + reckon command against a fake fetch
```

Expected: `ownerFromCounts` agrees with `deriveParentOwner` on all 8 `parentCases` of `reckoning-weeks.json`; `cellPolygonWkt` of `890d9100ad7ffff` (antimeridian) yields a ring whose longitudes span < 1°; `cellPolygonWkt` of `89080000003ffff` (pentagon) has 10 + 1 vertices; `bboxAreaKm2('23.85,54.87,23.98,54.93') / cellAreaKm2(9)` ≈ 530 cells (allowed) and the Lithuania box at res 9 is refused.

### A.2 Integration tests (real Postgres)

```bash
pnpm --filter @nature/api db:migrate      # applies 0000–0005
pnpm --filter @nature/api test            # with DATABASE_URL set: integration suites run (SKIP_PERF=1 to skip the 10 000-cell test)
```

Suites and what they prove:

| Suite | Asserts |
|---|---|
| `reckoning-fixture.test.ts` | seeds `reckoning-weeks.json` (10 cells, initial state W34), runs W35 → W36 → W37 with a `FakeClock`: per cell/week `hex_faction_strength` ±0.01, `hex_state.owner_faction_id`, `owner_since_week`, `captain_user_id`, `hex_ownership_events` exactly the fixture's `event`s, `hex_reckoning_history` rows; every parent (res 8–5) of the fixture cells equals `deriveParentOwner` over the children's owners read from `hex_state`; `leaderboard_snapshots` global/faction ranks equal a test-side sort of Σ `capped_meters`; `faction_stats_weekly` counts; `reckonings` rows `done` (SC-001) |
| `reckoning-resume.test.ts` | batch size 3, `hooks.afterBatch` throws after batch 1 → `reckonings` row `failed`, stage `cells`, cursor set; rerun → `resumed: true`, `attempt 2`; `tableSnapshot` equals a clean run on a second database (SC-002); rerun of a done week → `resumed: false`, zero row changes; a cell with `last_reckoned_week = W` is skipped |
| `reckoning-catchup.test.ts` | contributions in W35–W37, no reckonings, clock at W38 Monday → `runDueReckonings` runs W35, W36, W37 in order (three `done` rows, strengths decayed three times); a manual run for W36 before W35 → `RECKONING_OUT_OF_ORDER`; W34 (older than the first) → stored/no-op |
| `reckoning-cells.test.ts` | first-time cell: `hex_state` row created with `h3_r8..r5 = cellToParent` and `ST_Contains(geom, ST_Point(centre))`; parent rows created with `res` and `geom`; strength rows dropped below 0.001 deleted; `bonus-only` claims with `captain null`; flip XP: three players +15 each once, `users.xp` incremented, losing faction none, flip to null none; stale-walk autofinish invoked first (fake `autofinish`) |
| `hexes-list.test.ts` | res 9 box → exact cells sorted; contested cell (`owner 1`, strength 1 000, faction 2 earned 700 this week) → `pressureLeader 2, contested true`; res 5–8 boxes → parents with `pressureLeader null`; over-cap box → 400 `BBOX_TOO_LARGE` with `estimatedCells`; malformed boxes and `res 4/10` → `VALIDATION_FAILED` with `details.field`; no token → 401; 121st request in a minute → 429; 3 000-cell box timed < 300 ms (SC-004) |
| `hexes-detail.test.ts` | owned cell with captain → display name, strengths, `week.factions`, `me` (`explored`/`flipped`/`held`), 8 of 10 history rows newest first; never-walked valid cell → 200 empty; res-8 id → 400 |
| `reckonings-latest.test.ts` | after two reckonings → `weekId` = latest, `ranAt`, `nextAt` = next Monday 00:00 UTC, totals with `flipsGained/Lost`, `myFlips 2` + hexes for a contributor, `0` for another; before any reckoning → nulls and empties; `inProgress` while a row is `running` |
| `admin-reckonings.test.ts` | player/tester → 403; admin `sync` → 200 result; `dryRun` → 200 with `flipsPreview` and **zero** rows written (tableSnapshot unchanged, no `reckonings` row); `dryRun` without `sync` → 400; not-ended week → 400 `WEEK_NOT_ENDED`; out of sequence → 409; lock held (advisory lock taken by the test) → 409 `RECKONING_RUNNING`; async → 202 + a `pgboss.job` row with `singleton_key = 'reckoning.weekly'`; `JOBS_ENABLED=false` async → 503; `GET` → status; unknown → 404 |
| `reckoning-push.test.ts` | after W: one `push.send` row per contributing user with `flips`/`lost`, `singleton_key = reckoning:W:user`, `start_after` = Monday 08:00 UTC; rerun adds none; `boss null` → skipped with a log line |
| `reckoning-consistency.test.ts` | corrupt one parent's owner and one parent's counts, delete a third → `drifted 3`, kinds `owner`/`counts`/`missing`, `reckoning_consistency` row, error log; rows unchanged; `repair: true` → `repaired 3`, rows correct, second run `drifted 0` (SC-006) |
| `territory-purge-export.test.ts` | 002 FK-coverage test passes; purge → `leaderboard_snapshots.user_id null` (rank kept), `hex_state.captain_user_id null`, history refs null, `push.send` rows of the user gone, `hex_ownership_events` untouched; export bundle has `territory` section with flips/captainOf/leaderboard (SC-007) |
| `reckoning-perf.test.ts` | `gridSeed(centre, 58)` (10 267 cells, 2 factions, 3 users) → one reckoning `< 300 000 ms`, duration logged (SC-003); skipped with `SKIP_PERF=1` |
| `schema.test.ts` (extended) | new table/columns/indexes exist; `leaderboard_snapshots.user_id` nullable |
| `jobs.test.ts` (extended) | queues `reckoning.consistency` and `push.send` exist; `reckoning.weekly` schedule unchanged (`0 0 * * 1` UTC) |

### A.3 Manual run against a running API

```bash
pnpm --filter @nature/api dev &                                   # http://localhost:3000
pnpm --filter @nature/api dev:apple-stub &                        # 002: mint identity tokens
TOKEN_A=$(...)   # sign in tester A (faction 1), TOKEN_B=$(...) tester B (faction 2), TOKEN_ADMIN=$(...) then:
psql "$DATABASE_URL" -c "update users set role = 'admin' where id = '<admin user id>'"

# replay two tracks in different factions (003), then reckon the week (SC-005)
pnpm --filter @nature/walk-sim exec walk-sim replay packages/walk-sim/samples/azuolynas-loop.gpx --base-url http://localhost:3000 --token "$TOKEN_A" --rate 0 --json | jq '.summary.weekId'
pnpm --filter @nature/walk-sim exec walk-sim replay packages/walk-sim/samples/laisves-aleja-straight.gpx --base-url http://localhost:3000 --token "$TOKEN_B" --rate 0 --json | jq '.summary.weekId'
# the week must have ended: either wait for Monday or, in a dev database, backdate `hex_week_contribution.week_id` to last week
W=$(date -u -d 'last monday - 1 day' +%G-W%V)                      # ISO week that just ended
pnpm --filter @nature/walk-sim exec walk-sim reckon "$W" --base-url http://localhost:3000 --token "$TOKEN_ADMIN" --dry-run   # prints the flips, writes nothing
pnpm --filter @nature/walk-sim exec walk-sim reckon "$W" --base-url http://localhost:3000 --token "$TOKEN_ADMIN"             # runs it
curl -s -H "authorization: Bearer $TOKEN_A" 'http://localhost:3000/v1/hexes?res=9&bbox=23.85,54.87,23.98,54.93' | jq '.items[] | select(.owner != null)'
curl -s -H "authorization: Bearer $TOKEN_A" http://localhost:3000/v1/hexes/891f40da99bffff | jq '{owner, captain, week, me}'
curl -s -H "authorization: Bearer $TOKEN_A" http://localhost:3000/v1/reckonings/latest | jq '{weekId, nextAt, myFlips}'
curl -s -H "authorization: Bearer $TOKEN_ADMIN" "http://localhost:3000/v1/admin/reckonings/$W" | jq '{status, stage, hexesProcessed, flips}'

# the same from the job runner (no token needed)
pnpm --filter @nature/api job:reckoning -- --week "$W" --dry-run    # one line per flip, then the JSON result
pnpm --filter @nature/api job:reckoning                             # runs every due week in order
pnpm --filter @nature/api job:consistency                           # reports drift; add -- --repair to fix
```

Expected: the owners printed by the dry run equal the owners returned by `GET /v1/hexes` after the real run; the second `reckon` of the same week answers the stored result (`resumed: false`, same counts) and writes nothing.

### A.4 Contract snapshot

```bash
pnpm --filter @nature/api-schema snapshot && pnpm --filter @nature/api-schema test   # stale test green
git diff --stat packages/api-schema/openapi.json                                      # shows listHexes, getHex, getLatestReckoning, runReckoning, getReckoning (SC-008)
```

## B. Stream B — Integration (after A is merged)

```bash
pnpm install && git add pnpm-lock.yaml                          # h3-js as a direct dependency of @nature/api
pnpm lint && pnpm typecheck && pnpm test                       # SKIP_DB_TESTS=1 path green
DATABASE_URL=… pnpm test:db                                    # integration suites green (perf test included once; SKIP_PERF=1 in the PR loop)
pnpm --filter @nature/api-schema snapshot && pnpm --filter @nature/api-schema test   # re-run if 003 merged after A refreshed
grep -n 'reckoning.consistency\|/v1/admin/reckonings\|hex_reckoning_history\|push.send' docs/architecture.md   # all four present
grep -n 'hex-flip XP (+15)\|last 8 reckonings' docs/territory-rules.md                                          # unchanged wording the limits test relies on
git diff --exit-code packages/territory-rules packages/h3-fixtures apps/ios/Packages/TerritoryRules             # no rule changes
export SPECIFY_FEATURE=004-weekly-reckoning SPECIFY_FEATURE_DIRECTORY=specs/004-weekly-reckoning
# /speckit-analyze → specs/004-weekly-reckoning/analysis.md ; /speckit-converge until Converged
```

## Verification log

| Date | Stream | Commit | Result | Environment |
|---|---|---|---|---|
| — | A | — | (fill: unit/integration counts, perf duration for 10 267 cells) | Node 22, Postgres 16 + PostGIS, no h3-pg |
| — | B | — | (fill) | — |
