# Specification Analysis Report — 003-walk-tracking

Run by Stream C (integration) on 2026-09-07 with `SPECIFY_FEATURE=003-walk-tracking`, after Streams A (`c9ec6c7`) and B (`6de96b6`) were merged, against `spec.md` (21 FR, 8 SC, 5 user stories, 12 edge cases), `plan.md`, `tasks.md` (T001–T030), `data-model.md`, `contracts/openapi.yaml`, `research.md` and `.specify/memory/constitution.md` (v1.1.0). Read-only pass; the "Fixed" column records what the same integration run changed afterwards (T026–T030), so a rerun on the final tree reports the fixed rows as closed.

## Findings

| ID | Category | Severity | Location(s) | Summary | Recommendation | Fixed |
|----|----------|----------|-------------|---------|----------------|-------|
| I1 | Inconsistency | HIGH | `contracts/openapi.yaml` `WalkSummary.path`; `apps/api/src/modules/walks/schemas.ts`; `apps/ios/VERIFY.md` "Temporary OpenAPI document" | The contract and the snapshot wrote `path` as `oneOf: [$ref LineString, {type: null}]`; swift-openapi-generator 1.13.1 drops such a property and, with `additionalProperties: false`, the generated client rejects every finish/detail response (FR-017; SC-008 "the iOS client compiles from the snapshot" would hold while decoding fails). | Emit the same object inline as `type: [object, null]` (the generator maps it to an optional), keep it `required`; refresh the snapshot and the iOS copy. | Yes — `NullableLineString` rewritten, snapshot and `apps/ios/.../openapi.json` regenerated (TEMPORARY marker gone), contract updated to the same representation with a comment; `APIClient` 21/21 tests green, generated name `WalkSummary.PathPayload` unchanged |
| I2 | Inconsistency | MEDIUM | `docs/architecture.md` §4 step 1, §5 "Protection" vs FR-014, FR-021, `apps/api/src/modules/walks/limits.ts` | The doc said "token bucket (2 batches/min)" and `UIBackgroundModes = [location, audio]`; code and spec say 30 batches / 15 min, 20 walks / h, 8 640 samples / day, 300 XP / day and `[location]` only. | Write the numbers next to "Protection", `[location]` (audio in 006), enable the numeric assertions in `walks-limits.test.ts`. | Yes (T028) |
| I3 | Inconsistency | MEDIUM | `docs/architecture.md` §6 `walk_hex_meters` vs FR-011, migration `0004_walks`, `data-model.md` | The data-model block lacked the `capped_meters` column that the finish summary (`cappedMeters`) and the schema carry. | Add the column and a one-line meaning. | Yes (T028) |
| I4 | Inconsistency | MEDIUM | `docs/architecture.md` §5 REST block vs FR-007/FR-008/FR-010, `plan.md` Shared Semantics 3–5 | The REST block still showed the pre-003 sketch (`→ {walkId}`, `→ {accepted, rejected}`); the supersede rule, the provisional answer, the clamp and the idempotent finish were undocumented outside the spec. | Document the supersede rule, the provisional filter answer (§4 step 4) and the response shapes. | Yes (T028) |
| U1 | Underspecification | MEDIUM | `apps/ios/NatureExplorer/Info.plist` `NSLocationWhenInUseUsageDescription`, `NSMotionUsageDescription` | Both usage strings end in `TODO(owner): final copy.` FR-021 only requires the keys to be declared (satisfied), but App Review reads the copy. | Owner writes the final copy before the first TestFlight build; no code change. | No — owner action (`tasks.md` T031) |
| A1 | Ambiguity | MEDIUM | `tasks.md` T016 acceptance vs SC-002 vs `apps/ios/VERIFY.md` "R19 note" | T016 expected the incremental device estimate to equal the fixture's `hexMeters` within 0.5 m for `straight-line`, `teleport` and `car-speed`; the fixture's numbers come from the *simplified* path while the device estimates over the *raw* accepted path (research.md R19), so `straight-line` deviates up to 4.8 m per cell. SC-002 as written ("over the same accepted samples") is met exactly (0.0 m); the test asserts identical cells, conservation of metres and ±1 % of the walk length for the other two. | Keep SC-002; treat T016's line as over-strict (recorded in VERIFY.md). No code change. | Recorded (no edit to Stream B's code) |
| C1 | Coverage gap | LOW | SC-003 (5 s / 2 min timings), SC-006 (battery < 6 %/h) | Device-only measurements with no automated task; the spec already says SC-006 is "not a CI gate". | Owner follow-ups on a device. | Listed in `tasks.md` T031 |
| I5 | Inconsistency | LOW | `packages/api-schema/test/snapshot.test.ts` path list | With feature 004's in-progress routes in the working tree the snapshot lists `/v1/hexes*`, `/v1/reckonings/latest` and `/v1/admin/reckonings/{weekId}`, and the exact-list assertion fails; the two tests that matter for 003 (staleness, iOS-copy equality) pass. | Feature 004's API stream extends the list when it snapshots; nothing for 003 to change. | Left to 004 (its stream owns `packages/api-schema/**`) |
| I6 | Inconsistency | LOW | `README.md`, `CLAUDE.md` (`job:purge -- --user`), `apps/api/scripts/apple-stub.ts` | pnpm 10 forwards a literal `--` to the script; `parseArgs` in the Apple stub rejects it (the job runner strips it). The 002 docs mixed both forms. | Document "no `--`" once; write every example without it. | Yes (T026/T028) |
| D1 | Duplication | LOW | `plan.md` Conventions, `limits.ts`, `.env.example`, `docs/architecture.md` §5, `docs/territory-rules.md` step 4 | The walk limits are written in five places by design (plan → code → env → docs). | Acceptable: `walks-limits.test.ts` pins code ↔ `architecture.md` and the 11-key count; `territory-rules.md` only cross-references the XP cap as an abuse limit, not a constant (Constitution II untouched). | — |
| T1 | Terminology | LOW | `docs/territory-rules.md` (`capped_metres`), API/DB (`capped_meters`, `cappedMeters`) | British spelling in the rules doc, American in identifiers — the 001 convention, consistent across features. | None. | — |
| S1 | Status | LOW | `spec.md` **Status** | Still `Draft` after A and B merged. | Set to `Implemented` in converge. | Yes (T030) |

No CRITICAL findings. Overflow: none (11 findings).

## Coverage summary

| Requirement | Has task? | Task IDs | Notes |
|---|---|---|---|
| FR-001 foreground start, background only during the walk, faction required | Yes | T017, T018, T022, T024; T007 (server `FACTION_REQUIRED`) | `CLBackgroundActivitySession` in `Platform/`; reviewed by file list on Linux |
| FR-002 shared filter + 5 s / 10 m throttle + seq | Yes | T015 | `PathRecorderTests` fixture parity |
| FR-003 HUD with labelled estimate | Yes | T016, T022 | `HexMetersEstimatorTests`, `WalkViewModelTests` |
| FR-004 auto-pause 3 min, auto-end 6 h, recovery | Yes | T017, T024 | |
| FR-005 observable live path | Yes | T016 (`LivePath`) | consumed by 005 |
| FR-006 durable outbox, back-off, 429 wait, permanent failure | Yes | T019, T020 | `SyncCoordinatorTests` 15 |
| FR-007 idempotent create, overlap guard, supersede | Yes | T007 | `walks-create.test.ts` |
| FR-008 store-only batches, provisional answer | Yes | T008 | |
| FR-009 single-transaction `finishWalk` | Yes | T006, T009 | oracle deviation 0.0000 m |
| FR-010 end-time clamp | Yes | T006 | |
| FR-011 summary contents incl. week standing | Yes | T006, T009 | |
| FR-012 hourly autofinish, concurrent-safe | Yes | T010 | row lock in `finishWalk` |
| FR-013 owner-only history, cursor 20 | Yes | T009 | SC-007 |
| FR-014 ingest limits | Yes | T001, T008 | doc assertions enabled by T028 |
| FR-015 30-day server purge, 7-day device vacuum | Yes | T010 (`samples.purge`), T019 (`VacuumTests`) | |
| FR-016 erasure registry + export section | Yes | T011 | FK-coverage test green (`test:db`) |
| FR-017 OpenAPI snapshot + generated client | Yes | T012, T021, T027 | I1 fixed |
| FR-018 replay CLI + dry-run + sample tracks | Yes | T003, T004, T005 | 42 walk-sim tests |
| FR-019 integration tests vs oracle | Yes | T009 | |
| FR-020 Linux-testable iOS logic | Yes | T015, T019, T020 | 5 packages, 183 tests on Linux |
| FR-021 plist entries | Yes | T024 | U1: copy is the owner's |
| SC-001 oracle ±0.05 m, order-independent | Yes | T009 | |
| SC-002 estimate ±0.5 m, filter parity | Yes | T016 | A1 |
| SC-003 timings | No (device) | — | owner follow-up |
| SC-004 exactly-once outbox | Yes | T020 | |
| SC-005 autofinish, flagged → 0 | Yes | T009, T010 | |
| SC-006 battery | No (device) | — | owner follow-up, not a CI gate |
| SC-007 owner-only | Yes | T009 | |
| SC-008 snapshot staleness, client compiles | Yes | T012, T027, T029 | |

**Constitution alignment**: I — the HUD estimate is labelled provisional and the server summary replaces it; II — no rule constant changed (fixtures, both rules packages and `docs/territory-rules.md` "Constants summary" untouched; the walk limits live in the API as abuse limits); III — `commander`, `fast-xml-parser` (MIT, tooling) and the synthetic GPX tracks now have rows in `docs/licences.md`; IV — raw samples purged after 30 days, paths owner-only, erasure/export registered; V — every layer tested at its layer (Vitest unit + integration, XCTest on Linux, quickstart); VI — one task per PR kept; VII — offline outbox verified, battery budget unmeasured (SC-006, owner). No violations.

**Unmapped tasks**: none (T013, T025, T026–T030 are verification/integration tasks and map to "Integration" in `tasks.md`).

**Metrics**: 21 FR + 8 SC (6 buildable) = 29 requirements; 30 tasks (+ T031 appended by converge); coverage 100 % of FR and of buildable SC; ambiguity count 1; duplication count 1; critical issues 0; HIGH 1 (fixed).

## Next actions

- No CRITICAL/HIGH issue remains open; `/speckit-converge` follows.
- Owner: final usage-string copy (U1), SC-003/SC-006 device measurements, macOS `xcodebuild test` and simulator flows (`apps/ios/VERIFY.md` "Not verified here"), Docker `make test` — `tasks.md` T031.
- Feature 004's API stream: extend the path list in `packages/api-schema/test/snapshot.test.ts` when it refreshes the snapshot (I5).
