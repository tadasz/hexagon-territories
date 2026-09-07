# Specification Analysis Report — 004-weekly-reckoning

Run by Stream B (integration) on 2026-09-07 with `SPECIFY_FEATURE=004-weekly-reckoning`, after Stream A (`815612f`) was merged, against `spec.md` (20 FR, 8 SC, 5 user stories, 14 edge cases), `plan.md`, `tasks.md` (T001–T022), `data-model.md`, `contracts/openapi.yaml`, `research.md` and `.specify/memory/constitution.md` (v1.1.0). Read-only pass; the "Fixed" column records what the same integration run changed afterwards (T018–T022), so a rerun on the final tree reports the fixed rows as closed.

## Findings

| ID | Category | Severity | Location(s) | Summary | Recommendation | Fixed |
|----|----------|----------|-------------|---------|----------------|-------|
| I1 | Inconsistency | HIGH | `contracts/openapi.yaml` `HexDetail.captain`, `HexReckoningEntry.captain`; `apps/api/src/modules/territory/schemas.ts` `NullableCaptain`; `packages/api-schema/openapi.json` | Both `captain` properties were written as `oneOf: [$ref HexCaptain, {type: null}]` — the shape 003's I1 found unusable: swift-openapi-generator 1.13.1 logs `Schema "null" is not supported … skipping` and generates `HexDetail`/`HexReckoningEntry` **without** `captain`; with `additionalProperties: false` the generated decoder would reject every hex-detail response that carries a captain. FR-018/SC-008 ("005 can generate its client") would hold at compile time and fail at runtime. Verified here: `cd apps/ios/Packages/APIClient && swift test` on the refreshed snapshot printed the two warnings. | Emit the captain inline as `type: [object, null]` with the `HexCaptain` properties (the 003 fix), keep it `required`; refresh the snapshot and the iOS copy; align the contract. | Yes — `NullableCaptain` rewritten, `territory-schemas.test.ts` asserts the inline form for both schemas, contract updated with a comment, `pnpm --filter @nature/api-schema snapshot && apps/ios/scripts/sync-openapi.sh` rerun; `APIClient` 21/21 green with no generator warning; `hexes-detail` and `admin-reckonings` integration suites green (Fastify still serialises `null`) |
| I2 | Inconsistency | MEDIUM | `docs/architecture.md` §5 jobs, REST block; §6 | §5 still listed `parent.recompute`, had no `reckoning.consistency`, no `/v1/admin/reckonings/{weekId}`, and the `/v1/hexes*` sketch predated the cap/auth/rate-limit/`items` shape; §6 lacked `hex_reckoning_history`, `reckoning_consistency`, the `reckonings` stage/cursor columns, nullable `leaderboard_snapshots.user_id` and the flip-XP partial unique index (the T019 acceptance grep failed on three of four terms). | Document the stage machine, catch-up, advisory lock, `push.send` rows-only, res 5–8 without pressure, the admin endpoint and the four schema additions. | Yes (T019) |
| C1 | Coverage gap | MEDIUM | SC-005, `tasks.md` T021, `quickstart.md` A.3 | The roadmap phase-1 criterion (two GPX tracks in two factions → `walk-sim reckon --dry-run` → `walk-sim reckon` → list owners equal the dry-run flips) had no row in the verification log. Stream A ran A.3 in this session against a live API (`qs-tester-a` faction 1, `qs-tester-b` faction 2, `qs-admin` role admin; contributions backdated to 2026-W35/W36): W35 dry run 9 flips `- → 1`, W36 dry run 9 flips `1 → 2`, real runs `done` (18 cells, 9 flips, 7 parent flips each, 28–40 ms), `GET /v1/hexes` → exactly those 9 cells with `owner 2, ownerSince 2026-W36`; corroborated by the `reckonings` rows and the API log of the dev database. | Record the transcript in the log; keep A.3 as the release-branch smoke test. | Yes — `quickstart.md` "Verification log" rows A and B |
| U1 | Underspecification | MEDIUM | `plan.md` "Owner actions" 1–3 | Push send time (08:00 UTC vs local morning, decided for good in 008), confirmation of flip XP 15 / top 100 / 3 000-cell cap before public TestFlight, and the creation of an `admin` user per environment are owner decisions with no task. | Owner follow-ups; listed in `tasks.md` Phase 4 and `docs/status.md`. | Recorded (T023) |
| C2 | Coverage gap | LOW | `.github/workflows/api.yml`, `Makefile` `make test`, SC-003 on CI | No Docker daemon in the agent container: the h3-pg image build, the new `db:migrate` step and the `SKIP_PERF` split (skip on PRs, run on `push` to `main` / `workflow_dispatch`) were validated by `yq` parsing and by running the same commands against a local Postgres 16.13 + PostGIS, not by an Actions run. | The first CI run of the integration PR confirms the three jobs (as 002 T035 / 003 T035). | Recorded (T024) |
| I3 | Inconsistency | LOW | `spec.md` FR-015, `tasks.md` T008/T019 (`job:reckoning -- --week`) vs `README.md`/`CLAUDE.md` (no `--`) | pnpm 10 forwards a literal `--`; the job runner drops it (`run-args.ts`) while `scripts/apple-stub.ts` rejects it (003 I6). Both spellings work for `job:*`; the docs use the form that works everywhere. | None (spec wording kept; docs say "no `--`"). | — |
| I4 | Inconsistency | LOW | `tasks.md` T006 (`expireInHours 24`) vs `limits.ts` `PUSH_EXPIRE_IN_HOURS = 23`, `reckoning-push.test.ts` | pg-boss 10 caps `expireInHours` strictly below 24; the code uses 23 with a comment and the test asserts it. | The task text is the one that is off; no code change. | — |
| I5 | Inconsistency | LOW | `docs/roadmap.md` 004 scope (`walk-sim --reckon`), verification strategy (`--reckon <weekId>`) vs the shipped subcommand `walk-sim reckon <weekId>` | Terminology drift from the original plan. | Leave the historical scope text; the 004 row's done items and the README carry the real spelling. | Partial (done items) |
| A1 | Ambiguity | LOW | SC-004 ("under 300 ms p95") vs `hexes-list.test.ts` (one timed 3 000-cell request) | The suite times a single request (< 300 ms), not a p95 over many; the spec's own note calls the number a local target. | Acceptable for 004; a k6 harness comes with 008's load test. | — |
| D1 | Duplication | LOW | `limits.ts`, `apps/api/.env.example`, `README.md`, `docs/architecture.md` §5, `plan.md` Conventions | The three tunables (batch size, bbox cap, consistency cron) are written in five places by design (plan → code → env → docs); only the flip XP and the history length are test-pinned to `docs/territory-rules.md`. | Acceptable (002/003 pattern); the territory constants themselves stay in one place (Constitution II). | — |
| S1 | Status | LOW | `spec.md` **Status** | Still `Draft` after Stream A merged. | Set to `Implemented` in converge. | Yes (T022) |

No CRITICAL findings. Overflow: none (11 findings).

## Coverage summary

| Requirement | Has task? | Task IDs | Notes |
|---|---|---|---|
| FR-001 Monday 00:00 UTC, in-order catch-up, start-up catch-up | Yes | T007, T008 | `reckoning-catchup.test.ts`; `registerJobs` runs `runDueReckonings` once |
| FR-002 autofinish first, then every cell with strength or contributions, first-time cells with parents + polygon | Yes | T004, T006, T007 | `reckoning-cells.test.ts` (`ST_Contains`) |
| FR-003 decay, cap, ownership via the rules package | Yes | T004 | 30 cell-weeks of `reckoning-weeks.json` (SC-001) |
| FR-004 strengths, owner, since, captain, history, event | Yes | T006, T007 | `reckoning-fixture.test.ts` |
| FR-005 +15 XP once per beneficiary | Yes | T002 (partial unique index), T006 | idempotent rerun asserted |
| FR-006 incremental parents, negative count fails loudly | Yes | T005, T006 | `territory-parents.test.ts` |
| FR-007 leaderboards top 100 + faction stats | Yes | T006 | `reckoning-rollup.test.ts` |
| FR-008 one push row per contributor, idempotent | Yes | T006, T011 | `reckoning-push.test.ts`; worker in 008 |
| FR-009 idempotent + resumable, singleton + lock | Yes | T007 | `reckoning-resume.test.ts` (SC-002), `reckoning-dryrun.test.ts` (lock) |
| FR-010 `GET /v1/hexes` res 5–9, cap, auth, rate limit | Yes | T009 | `hexes-list.test.ts` (SC-004) |
| FR-011 pressure leader / contested shared with 003 | Yes | T003, T012 | `walks-standing.test.ts` extended |
| FR-012 `GET /v1/hexes/{h3}` | Yes | T009 | `hexes-detail.test.ts`; I1 fixed for the client |
| FR-013 `GET /v1/reckonings/latest` | Yes | T010 | nulls before the first reckoning |
| FR-014 admin endpoint, role guard, errors | Yes | T011 | `admin-reckonings.test.ts` |
| FR-015 runner flags, `walk-sim reckon` | Yes | T008, T015 | `jobs-run-args.test.ts`, `reckon.test.ts`; I3 |
| FR-016 nightly consistency, repair on request | Yes | T005, T008 | `reckoning-consistency.test.ts` (SC-006) |
| FR-017 erasure + export section | Yes | T013 | `territory-purge-export.test.ts` (SC-007) |
| FR-018 snapshot refreshed, 001–003 operations unchanged | Yes | T016, T018 | snapshot test path list; I1 |
| FR-019 fixture replay integration tests | Yes | T007 | SC-001 |
| FR-020 no rule/iOS changes | Yes | T018 | `git diff --exit-code packages/territory-rules packages/h3-fixtures apps/ios/Packages/TerritoryRules` clean |
| SC-001 fixture parity | Yes | T007 | |
| SC-002 idempotent + resume | Yes | T007 | |
| SC-003 10 000 cells < 5 min | Yes | T014 | 10 267 cells in 2.0–4.4 s |
| SC-004 3 000-cell box < 300 ms | Yes | T009 | A1 |
| SC-005 replay + reckon end to end | Yes | T021 | C1 — verified from Stream A's live run |
| SC-006 drift detected, repaired only on request | Yes | T008 | |
| SC-007 erasure leaves no reference | Yes | T013 | |
| SC-008 snapshot test green, five operations | Yes | T016, T018 | |

**Constitution alignment**: I — ownership changes only inside `runReckoning` stage `cells` (`writes.ts`) and, for parent rows only with `--repair`, `recomputeParents` (`parents.ts`); every read model is derived. II — `grep` for `0.5`, `500`, `1.1`, `0.4`, `2000` in `reckoning/*.ts`, `pressure.ts` and `walks/standing.ts` finds nothing; `applyWeeklyCap`, `reckonWeek`, `deriveParentOwner`, `weekIdFor` and `RULES` are the only rule sources; fixtures, both rules packages and the "Constants summary" untouched (FR-020). III — `h3-js` is covered by the existing Uber H3 row in `docs/licences.md`; no new asset. IV — erasure anonymises leaderboard rows, clears captain/history references and queued pushes; the export bundle gains `territory`. V — unit + integration (345 DB tests) + quickstart at every layer. VI — one task per PR kept. VII — n/a (no client code). No violations.

**Unmapped tasks**: none (T017–T022 are verification/integration tasks and map to "Integration" in `tasks.md`).

**Metrics**: 28 requirements (20 FR + 8 SC), 22 tasks (+2 appended by converge), coverage 100 %, ambiguity 1, duplication 1, critical 0, high 1 (fixed).
