# Specification Analysis Report: 002-auth-and-factions

Produced by the `/speckit-analyze` procedure on 2026-09-07 (Stream C, after Streams A `1b53aa1` and B `461afc4` landed and the root was wired). Inputs: `spec.md`, `plan.md`, `tasks.md`, `data-model.md`, `research.md`, `contracts/openapi.yaml`, `quickstart.md`, `.specify/memory/constitution.md` v1.1.0. `check-prerequisites.sh --json --require-spec --require-tasks --include-tasks` reported `FEATURE_DIR=specs/002-auth-and-factions`, `AVAILABLE_DOCS=[research.md, data-model.md, contracts/, quickstart.md, tasks.md]`. No `.specify/extensions.yml` exists, so no hooks ran.

The analysis itself is read-only; "Remediation applied" lists the edits Stream C made afterwards under T028–T030 for the findings it could fix. Environment: Linux container with Node 22, pnpm 10, local Postgres 16 + PostGIS, Swift 6.2.1; no Docker/MinIO, no macOS.

## Findings

| ID | Category | Severity | Location(s) | Summary | Recommendation |
|----|----------|----------|-------------|---------|----------------|
| C1 | Coverage | HIGH | `spec.md` US1/AC3, US2/AC4–AC5, FR-004, FR-008, SC-001, SC-002; `apps/ios/NatureExplorer/*`, `apps/ios/VERIFY.md` | The app target (`RootView` gate, `KeychainStore`, `SignInView`, six tabs) and the SwiftUI views of the three feature packages are parsed and reviewed on Linux but only compile, run and get their `XCTest`/simulator verification on macOS. `AppContainerTests`/`RootGateTests` exist but have not executed. | Follow-up task on a macOS machine (tasks.md T032): `xcodegen generate`, `xcodebuild test`, the simulator flow of `quickstart.md` §B, commit `Package.resolved`. |
| C2 | Coverage | MEDIUM | `spec.md` SC-006 ("downloadable within 5 minutes in local and CI"), US6/AC2, `quickstart.md` A.4/A.6, `tasks.md` T015 | The export path is proven in-process with `MemoryObjectStorage` (`export.test.ts`: bundle validates, states, expiry); the real S3 layer (`S3_TEST=1` against MinIO), the `job:export` CLI and the `mc ilm` lifecycle rule in `infra/docker-compose.yml` were only parsed, never executed (no Docker in any stream's container). | Run `quickstart.md` A.4 and A.6 once on a Docker machine (T034). |
| C3 | Coverage | LOW | `plan.md` Technical Context ("freeze versions"), `apps/ios/VERIFY.md` Notes | `Package.resolved` for `APIClient` (and `MapFeature`) is not committed; the Linux resolution picked `swift-openapi-generator` 1.13.1 / runtime 1.12.1 / urlsession 1.3.1 / http-types 1.8.0 but Stream B decided to freeze on the first macOS resolution. | Commit it with T032. |
| U1 | Underspecification | MEDIUM | `spec.md` FR-004, SC-002; `apps/ios/Packages/AuthFeature/Sources/AuthFeature/KeychainStore.swift` | Keychain persistence has no unit test (the fakes cover `AuthSession`, `RecordingTokenStore` covers the protocol); the only check is the simulator flow "force-quit → relaunch → still signed in". | Accept for 002 (Security framework is macOS/iOS only); the simulator step is part of T032. |
| I1 | Inconsistency | MEDIUM | `docs/architecture.md` §6 vs `data-model.md` §1.1, `apps/api/src/db/schema/exports.ts`, migration `0003_auth_exports.sql` | The data-model section of the architecture doc listed `users`, `refresh_tokens` and `devices` but not the new `account_exports` table. | Add the row (applied — see below). |
| I2 | Inconsistency | MEDIUM | `tasks.md` T030 ("optional `swift` job … `swift-actions/setup-swift@v2` … `H3Kit`, `TerritoryRules`, `Core`") vs `.github/workflows/api.yml` | The job was implemented with the official `swift:6.2.1-noble` container (pins the exact toolchain recorded in `VERIFY.md`; the action's version → toolchain mapping is not pinned the same way) and covers all eight Linux-buildable packages, as Stream B's hand-over recommended. | Keep; deviation stated in the workflow header. Verify the image tag on the first CI run (T035). |
| I3 | Inconsistency | LOW | `tasks.md` T018 (`Tests/CoreTests/Fakes/`), T021–T023 vs `apps/ios/Packages/Core/Sources/CoreTestSupport` | Fakes live in the `CoreTestSupport` library product so the four other test targets share them; `Core` also gained `App/SessionGate.swift` and `Support/JSONValue.swift`, `APIClient` an `ErrorEnvelopeMiddleware`, `AppContainer` a `ProfileCache` (UserDefaults, no e-mail — `Me` carries none). | Accept; all are documented in `VERIFY.md` "Deviations" and tested on Linux; `ProfileCache` keeps the offline-launch behaviour `quickstart.md` §B asks for. |
| I4 | Inconsistency | LOW | `contracts/openapi.yaml` vs `packages/api-schema/openapi.json` | The snapshot carries `/health`, `/openapi.json` and `HealthResponse` (feature 001) that the fragment does not, and `info.version` `0.1.0` vs the fragment's `0.2.0`. Every 002 path, `operationId`, status code, schema name and property set is identical (checked by script). | Expected: the fragment stands alone, the snapshot is the merged runtime document (Constitution "Development Workflow"). Bump `info.version` to `0.2.0` when the API version is next touched (not a 002 task). |
| A1 | Ambiguity | LOW | `spec.md` Assumptions, `plan.md` Owner actions 1, `quickstart.md` Owner actions | The bundle id `com.natureexplorer.app` is still called a placeholder (`TODO(owner)`), but 001's analysis (T054) recorded it as confirmed final on 2026-09-07. The remaining owner step is enabling the Sign in with Apple capability on the App ID and setting `DEVELOPMENT_TEAM`, not choosing an id. | Owner action T033; spec/plan wording left as is (read-only analysis). |
| A2 | Ambiguity | LOW | `spec.md` Edge Cases ("Keys are cached so a brief outage does not affect sign-in") | `JoseAppleVerifier` uses `jose`'s remote JWKS with its built-in cache (`research.md` R1); `auth-apple.test.ts` covers "JWKS down → `APPLE_UNAVAILABLE`" but not "cached key survives an outage". | Low risk (library behaviour); add a cache-hit case if the verifier is touched again. |
| D1 | Deferred | LOW | `plan.md` Deviations, `research.md` R4/R15 | In-memory rate-limit counters (single instance), Apple-side token revocation on erasure, `devices` rows at sign-in: deferred by decision, not gaps. | No task; 008/009 pick them up. |

No duplicate requirements were found. No constitution MUST is violated by the spec, plan, tasks or the code reviewed (see below).

## Coverage Summary

| Requirement Key | Has Task? | Task IDs | Notes |
|-----------------|-----------|----------|-------|
| FR-001 Sign in with Apple only, server-side token verification | Yes | T005, T008 (A); T021 (B) | 7 verifier unit cases + `auth.test.ts` (wrong audience → 401) pass |
| FR-002 first-sign-in data, default display name, no overwrite | Yes | T008 | `auth.test.ts`: given name / `Explorer NNNN` / returning user keeps name and faction |
| FR-003 15 min access, 60 d refresh, rotation, reuse revokes all, logout | Yes | T006, T008 (A); T018 (B) | `tokens.test.ts` integration: zero valid tokens after reuse (SC-004) |
| FR-004 Keychain, restore, silent renewal, sign-in on failure | Partial | T018, T020, T021, T025 (B) | `AuthSession` (66 Core tests) and `AuthMiddleware` (13) on Linux; `KeychainStore` + app gate need macOS (C1, U1) |
| FR-005 auth endpoints throttled 20/min with envelope + wait time | Yes | T007, T008 | all three `/v1/auth/*` routes carry `config.rateLimit`; `rate-limit.test.ts` |
| FR-006 factions with live stats, no auth, cached | Yes | T009 (A); T022 (B) | `factions.test.ts` SC-003 scenarios; `Cache-Control: public, max-age=60` |
| FR-007 first pick free, 30-day lock with `nextChangeAt` | Yes | T009, T010 (A); T019, T022 (B); T029 (C) | `me.test.ts` 409 with exact timestamp; doc rows updated |
| FR-008 pick screen until faction set, six tabs | Partial | T024, T025 (B) | `SessionGate` decisions tested on Linux; `RootView` on macOS (C1) |
| FR-009 profile read/update, display-name rule | Yes | T010 (A); T019, T023 (B) | §2.7 vector in both languages; `GET /v1/me` has no `email` |
| FR-010 delete: soft delete, revoke, refuse, purge after 30 d | Yes | T011, T013 (A); T023 (B) | FK-coverage assertion + idempotent purge (SC-005) |
| FR-011 restore in grace, new account after purge | Yes | T008, T011 | `auth.test.ts` restored → true; `delete-purge.test.ts` new id after purge |
| FR-012 export bundle, 7 d, 1 h links, reuse while pending/fresh | Yes (real storage unverified) | T004, T012, T013, T015 (A); T023 (B) | `export.test.ts` with `MemoryObjectStorage`; MinIO path pending (C2) |
| FR-013 `/v1/me*` require token, deleted refused, `last_seen_at` throttle | Yes | T007, T010 | `auth-plugin.test.ts` (15 min throttle) |
| FR-014 OpenAPI snapshot + stale test, generated iOS client | Yes | T014 (A); T020 (B); T028 (C) | snapshot current; iOS copy equal (test no longer skipped); generator ran on Linux |
| FR-015 no e-mail/tokens in logs | Yes | T003, T008 | pino redaction; `auth-logging.test.ts`; `export.test.ts` error has no PII |
| FR-016 pure iOS logic Linux-testable | Yes | T017–T019 (B) | `Core` imports no UIKit/SwiftUI/AuthenticationServices/Security; 66 tests |
| SC-001 sign-in to tabs < 2 min, ≤ 3 taps | Partial | T025 | simulator flow (C1) |
| SC-002 returning player, no prompt, silent renewal | Partial | T018, T025 | `AuthSession` tests; device flow on macOS (C1) |
| SC-003 suggestion = fewest active, tie → lowest id | Yes | T009 | distinct counts, tie, empty world, inactive/deleted excluded |
| SC-004 forged/expired/wrong-audience/reuse refused | Yes | T005, T006, T008 | unit + integration |
| SC-005 purge leaves zero rows, idempotent | Yes | T011 | FK coverage from `information_schema` |
| SC-006 export within 5 min, bundle validates | Partial | T012, T015 | in-process proof; MinIO run pending (C2) |
| SC-007 stale snapshot fails, client compiles from it | Yes | T014, T028 | mutation check per `quickstart.md` A.5; `APIClient` built from the snapshot |
| SC-008 `Core` passes `swift test` on Linux incl. the four session cases | Yes | T017, T018, T026 | 66 tests: refresh success/failure, 10 concurrent callers → 1 refresh, restore from store, 30 s skew |

**Unmapped tasks**: none (T001–T031 all trace to a story or to the integration closure). **Unrequested code**: see I3 (accepted).

## Constitution Alignment

| Principle | Result |
|---|---|
| I Server-authoritative | PASS — the client never computes the suggestion or the lock; `hex_state` untouched |
| II One place per rule | PASS — 30 d / 14 d live in `apps/api/src/modules/factions/rules.ts`; `factions-rules.test.ts` now asserts both values against `docs/territory-rules.md` "Other rules" (14-day assertion enabled by T029); "Constants summary" unchanged, the Swift/TS constants tests still pass |
| III Licence before ship | PASS — no model/data/tile/image added; `docs/licences.md` gained rows for `swift-openapi-runtime`/`-urlsession`, `swift-http-types` and the generator (all Apache 2.0) |
| IV Privacy by default | PASS — deletion + export are the feature; e-mail only in the export bundle, redacted in logs; EU storage |
| V Test at the layer you touch | PASS on the API and Linux Swift layers (140 API tests incl. integration against real Postgres; 158 Swift tests); the Xcode Cloud / `xcodebuild` layer is pending (C1) — same situation as 001's T050/T051 |
| VI Small, mergeable steps | PASS — three streams, disjoint paths; follow-ups appended as new tasks, none widened |
| VII Battery and offline | PASS (N/A) — offline restore from Keychain plus `ProfileCache`; no background modes |
| Workflow: contracts merged into `packages/api-schema`, generated client | PASS — see FR-014 |

## Metrics

- Total requirements: 24 (FR-001–FR-016, SC-001–SC-008) + 33 acceptance scenarios + 10 edge cases
- Total tasks: 31 (16 A, 10 B, 5 C)
- Coverage: 100 % have ≥ 1 task; 5 requirement keys (FR-004, FR-008, SC-001, SC-002, SC-006) are **partial** pending macOS or Docker verification
- Ambiguity count: 2 (A1, A2) — both LOW
- Duplication count: 0
- Critical issues: 0; High: 1 (C1); Medium: 4 (C2, U1, I1, I2); Low: 6

## Remediation applied (Stream C, 2026-09-07)

- I1: `docs/architecture.md` §6 now lists `account_exports`; §5 lists `POST /v1/auth/logout`, `GET`/`PATCH /v1/me`, the enqueuing `GET /v1/me/export` and the two account jobs.
- I2: `.github/workflows/api.yml` header states the container choice and which packages stay macOS-only; the `rules` job builds `@nature/api` before the `@nature/api-schema` test.
- FR-014 / SC-007: `apps/ios/Packages/APIClient/Sources/APIClient/openapi.json` replaced by the snapshot; all eight Swift packages re-tested with it (`apps/ios/VERIFY.md`).
- Constitution II/III: `docs/territory-rules.md` rows, 14-day assertion enabled, licence rows added.
- Not fixable here: C1, C2, C3, U1 (macOS / Docker / owner) → `tasks.md` Phase 4.

## Next Actions

No CRITICAL findings. Proceed with the integration PR; `/speckit-converge` appended the follow-up tasks (T032–T035) for the macOS, Docker and owner items, after which the feature converges.
