# Specification Analysis Report: 001-repo-foundations

Produced by the `/speckit-analyze` procedure on 2026-09-07 (Stream E, after Streams A–D landed and the root was wired). Inputs: `spec.md`, `plan.md`, `tasks.md`, `data-model.md`, `quickstart.md`, `.specify/memory/constitution.md` v1.0.0. `check-prerequisites.sh --json --require-spec --require-tasks --include-tasks` reported `FEATURE_DIR=specs/001-repo-foundations`, `AVAILABLE_DOCS=[research.md, data-model.md, contracts/, quickstart.md, tasks.md]`. No `.specify/extensions.yml` exists, so no hooks ran.

The analysis itself is read-only; the "Remediation applied" section lists the edits Stream E made afterwards under T044/T046 for the findings it could fix.

## Findings

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| I1 | Inconsistency | HIGH | `data-model.md` §1.2 vs `packages/h3-fixtures/fixtures/latlng-to-cell.json`, `H3KitTests`, `TerritoryRulesTests` | The fixture example said `boundaryVertexCount` is 5 for the pentagon case; H3 returns 10 vertices for a res-9 (class III) pentagon and both suites assert 10. | Correct the doc to 10 (applied — see below). |
| I2 | Inconsistency | HIGH | `tasks.md` T025 vs `apps/api/src/jobs/reckoning-weekly.ts` | The job kept a local `RECKONING_CRON` constant (`TODO(T044)`) instead of `RULES.RECKONING_CRON` from `@nature/territory-rules`; two sources for one constant would violate Constitution II once the value changes. | Add the workspace dependency and import `RULES` (applied under T044). |
| I3 | Inconsistency | MEDIUM | `spec.md` FR-008 ("Postgres service container") vs `plan.md` Deviations, `.github/workflows/api.yml` | CI starts the image with `docker build` + `docker run`, not a `services:` container, because the h3-pg image is not published. | Keep; the deviation is justified in `plan.md`. Publish to GHCR later and switch to `services:` (follow-up, not this feature). |
| I4 | Inconsistency | MEDIUM | `spec.md` US4 "Independent Test" ("Perch v2 with licence and hash") vs `tasks.md` T039, `ml/models/manifest.json` | Perch v2 is listed with licence and URL but `sha256: null` (manual Kaggle download, evaluation only, feature 006). | Pin the hash when feature 006 evaluates Perch, or narrow the spec sentence to the two primary models (tracked as T055). |
| I5 | Inconsistency | MEDIUM | `spec.md` US4 AC1 vs `plan.md` Deviations, `ml/scripts/download_models.py` | Spec says the script fetches into `apps/ios/Resources/Models`; the script writes to `ml/models/cache/` and `--dest` copies. Justified in `plan.md` (stream isolation). | Keep; the LFS commit step is T047/T049. |
| I6 | Inconsistency | MEDIUM | `plan.md` Constitution Check row V, `constitution.md` V ("Testcontainers") vs `research.md` R7, `api.yml` | Integration tests use Testcontainers only as the third fallback; CI and `make test` use `DATABASE_URL`. The Postgres image is still the real one, so the principle's intent (real Postgres) holds. | Accept; documented in `plan.md` Deviations ("API tests can run without Docker"). |
| I7 | Inconsistency | LOW | `research.md` R11 ("`weekIdFor` is not part of 001") vs `packages/territory-rules/src/week.ts`, `TerritoryRules/Sources/.../WeekId.swift` | Both rule packages already ship `weekIdFor` with hand-written unit tests but no shared fixture. | Keep (harmless, tested, needed by 003/004) and add the `week-ids.json` fixture in feature 003 (T056). |
| T1 | Terminology | LOW | `spec.md` US1/US2 Independent Test (`pnpm --filter territory-rules`, `pnpm --filter api`) vs `plan.md` "Package and Target Names" | Package filters in the spec omit the `@nature/` scope used everywhere else. | Use `@nature/territory-rules` / `@nature/api` when the spec is next edited (not blocking; `quickstart.md` has the right names). |
| T2 | Terminology | LOW | `plan.md` Technical Context ("`python -m unittest` for `ml/scripts`") vs `tasks.md` T039/T040, `ml/tests/` | Tests live in `ml/tests`, not `ml/scripts`. | Cosmetic; `quickstart.md` D has the actual command. |
| A1 | Ambiguity | LOW | `plan.md` "Owner actions", `apps/ios/project.yml`, `quickstart.md` | `TODO(owner)` placeholders (bundle id `com.natureexplorer.app`, `DEVELOPMENT_TEAM`) are intentional and labelled. | Keep until the brand is named (T054). |
| U1 | Underspecification | LOW | `spec.md` SC-001 ("within 30 minutes") | Measurable but only verifiable by a human on a Docker machine; no task can assert it. | Verify once on a Docker machine (T052) and record the time in `quickstart.md`. |
| C1 | Coverage | LOW | `spec.md` US3 AC4, FR-008 (Xcode Cloud), SC-003 | Requires an owner action (connect the repository) before any task can verify it. | Owner action T051; nothing else buildable. |

No duplicate requirements were found. No constitution MUST is violated by the spec, plan or tasks (see "Constitution Alignment" below).

## Coverage Summary

| Requirement Key | Has Task? | Task IDs | Notes |
|-----------------|-----------|----------|-------|
| FR-001 monorepo layout, prototype untouched | Yes | T001, T014, T028, T036, T043, T046 | Subset of §3 as listed in `plan.md` "Structure Decision"; `prototype/index.html` unchanged |
| FR-002 pure TS rules exports + constants | Yes | T002, T008–T013 | `src/index.ts` exports all six functions and `RULES` |
| FR-003 four fixtures, schema, generator, hand review | Yes | T003–T007 | Generator is deterministic (verified: regenerate → no diff) |
| FR-004 Swift `TerritoryRules` + `H3Kit` surface | Yes | T028–T033, T045 | `H3.swift` exposes all six H3 functions; 21 + 29 tests pass on Linux |
| FR-005 `/health`, `/openapi.json`, migrations, `reckoning.weekly` | Yes | T018–T026, T044 | 37 API tests pass against a real Postgres |
| FR-006 compose + `make dev/test/down` | Yes | T015–T017, T052 | `docker compose config` lists four services; not executed here (no daemon) |
| FR-007 XcodeGen app, five tabs, MapLibre Kaunas | Partial | T034–T037, T050 | Sources reviewed and parsed on Linux; compile/run needs macOS |
| FR-008 CI: `api.yml` + Xcode Cloud | Partial | T027, T048, T051, T052 | Workflow parses and matches the root scripts; first real run is the integration PR; Xcode Cloud is an owner action |
| FR-009 manifest + download/verify script | Yes | T039–T041 | Both primary models pinned with sha256; 27 Python tests pass |
| FR-010 ADRs 0001–0010, `docs/licences.md`, linked from README | Yes | T042, T046 | README links verified (no missing targets) |
| FR-011 `.gitignore` rules | Yes | T043 | `*.xcodeproj`, raw `*.onnx`/`*.tflite` outside `apps/ios/Resources/Models`, `.specify/feature.json` (via `.specify/.gitignore`) all ignored |
| SC-001 green `make test` in 30 min | Partial | T017, T052 | Needs a Docker machine |
| SC-002 mutation fails both suites | Yes | T013, T032, T045 | Verified in TS (Stream E) and Swift (Stream C, `VERIFY.md`) |
| SC-003 Xcode Cloud < 20 min | No buildable work | T051 | Owner action |
| SC-004 converge reports Converged | Yes | T048 | See "Phase 6: Convergence" in `tasks.md` |
| US1 AC1–AC4 | Yes | T004–T012, T030–T033 | All fixture suites green in TS and Swift |
| US2 AC1–AC4 | Yes | T016, T023–T026, T044 | AC1 (`make dev`) needs Docker: T052 |
| US3 AC1–AC4 | Partial | T036–T037, T050, T051 | macOS / Xcode Cloud |
| US4 AC1–AC2 | Partial | T041, T042, T049, T053 | LFS commit and inquiry sent dates outstanding |

## Constitution Alignment Issues

None. Checked I (no scoring code path; nothing writes `hex_state.owner_faction_id`), II (single source for constants after T044; both suites read the same fixtures), III (every model has a licence; non-commercial BirdNET V2.4 is `prototype-fallback` with `manual: true`; `docs/licences.md` rows present), IV (30-day partitioned `location_samples`, no analytics SDK), V (fixture-driven unit tests, real-Postgres integration tests, XCTest, executable `quickstart.md`), VI (one task per PR-sized unit), VII (N/A). Workflow rules: `plan.md` references the architecture docs and lists deviations; contracts live in `contracts/openapi.yaml`; constants change only via `docs/territory-rules.md` + `config.ts` (test enforced).

## Unmapped Tasks

None — every task in T001–T048 carries a `[USn]` tag or is an integration task (T043–T048) mapped to FR-001/FR-008/FR-010/FR-011/SC-004.

## Metrics

- Total requirements (FR + buildable SC + user-story ACs): 11 FR + 4 SC + 14 AC = 29
- Total tasks: 48 (T001–T048) before convergence
- Coverage: 29/29 keys have at least one task (100 %); 6 keys are only partially verifiable in a Linux container without Docker, macOS, git-lfs or owner access
- Ambiguity count: 1 (A1, intentional placeholders)
- Duplication count: 0
- Critical issues: 0; High: 2 (both fixed); Medium: 4 (documented deviations); Low: 6

## Remediation applied (Stream E, T044/T046)

- I1: `data-model.md` §1.2 now says `10 for the pentagon case (class III resolutions add distortion vertices)`.
- I2: `apps/api/package.json` depends on `@nature/territory-rules: workspace:*`; `reckoning-weekly.ts` re-exports `RECKONING_CRON = RULES.RECKONING_CRON` and `RECKONING_TZ = RULES.TZ`; the unit test still asserts `'0 0 * * 1'`.
- Root scripts, CI, README, CLAUDE.md and `quickstart.md` were aligned so that every command in the artifacts is one that actually exists (`pnpm test` = unit, `pnpm test:db` = with DB suites, `make test` = `pnpm test:db`).

## Next Actions

No CRITICAL issues. MEDIUM items are documented deviations (I3, I5, I6) or deferred by design (I4 → T055). Proceed with `/speckit-converge`; the remaining work is environmental (macOS, Docker, git-lfs) or owner decisions and is appended to `tasks.md` as "Phase 6: Convergence" (T049–T056).
