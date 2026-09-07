# Roadmap and feature backlog

Team assumption: 1 iOS engineer, 1 backend engineer, 0.5–1 ML/full-stack, plus coding agents running the Spec Kit loop. Effort is calendar weeks for that team.

## Feature backlog (Spec Kit)

Create each feature with the exact number and short name below so directories and branches match this table:

```
.specify/scripts/bash/create-new-feature.sh --number N --short-name <short-name> "<description>"
```

| # | Short name | Scope | Depends on |
|---|---|---|---|
| 001 | repo-foundations | Monorepo layout, territory-rules + fixtures (TS and Swift), Postgres image, API skeleton, XcodeGen app shell with MapLibre map, CI (Xcode Cloud + GitHub Actions), ADRs, model downloads and licence inquiries | — |
| 002 | auth-and-factions | Sign in with Apple, JWT + refresh, faction pick with smallest-faction suggestion (pre-select the faction with the fewest active players), profile, account deletion | 001 |
| 003 | walk-tracking | Walk sessions, background location, path recording, live per-hex metres estimate, offline outbox, `finishWalk` with authoritative metres, walk history | 002 |
| 004 | weekly-reckoning | Contributions, weekly decay, ownership with hysteresis, captains, parent rollup, contested read model, results push, idempotency, `walk-sim --reckon`. **Done** (`specs/004-weekly-reckoning`, Converged 2026-09-07): staged, resumable, idempotent `reckoning.weekly` with advisory lock and in-order catch-up; `hex_reckoning_history`; incremental parents + nightly `reckoning.consistency` (`--repair` on request); `GET /v1/hexes`, `GET /v1/hexes/{h3}`, `GET /v1/reckonings/latest`; admin `POST/GET /v1/admin/reckonings/{weekId}` with dry run; `job:reckoning --week/--dry-run`, `job:consistency`; `walk-sim reckon`; `push.send` rows queued (no worker yet); purge/export steps; 10 267 cells reckoned in 2–4 s | 003 |
| 005 | hex-map | MapLibre map, OpenFreeMap basemap (light/dark styles), hex overlay by resolution with cross-fade, own-paths layer, hex detail sheet with weekly history | 004 |
| 006 | bird-capture | Audio pipeline, BirdNET+ V3 + Geomodel on device via ONNX Runtime, listening UI, clip upload, Python verification worker, bird field guide, capture bonus, eval set | 003 |
| 007 | plant-capture | Camera flow with organ tags, Pl@ntNet integration, confirm UI, plant field guide, offline queue, Pl@ntNet Pro | 006 |
| 008 | game-layer | XP/levels, streaks, weekly + all-time leaderboards, faction stats, "hex lost"/"dethroned" pushes, MVT hex tiles, App Attest, anti-cheat flags + admin pages, achievements v1; from 004: push delivery for the queued `push.send` rows (worker + device registration, local-morning `startAfter`), parent pressure/contested at res 5–8 | 004, 006, 007 |
| 009 | release | Onboarding, permission priming, Lithuanian localisation, accessibility, privacy manifest, data export, reviewer notes + video, Xcode Cloud release workflow, App Store submission | 008 |
| 010 | plant-on-device | Core ML classifier for ~300 common Lithuanian taxa, live viewfinder hints, provisional offline entries | 007 |
| 011 | android | Android app as a new feature series after the App Store release, reusing the API and the TypeScript territory rules (Kotlin port runs the same `packages/h3-fixtures`) | 009 |

Features 006 and 004/005 are independent; agents can run them in parallel.

## Phases

| Phase | Features | Weeks | Exit criteria | Key risks |
|---|---|---|---|---|
| 0 — Foundations | 001 | 2 | `pnpm test` (GitHub Actions) and `xcodebuild test` (Xcode Cloud) green; identical fixture results in TS and Swift; `make dev` runs API + DB; `/speckit-converge` Converged | Vendoring the H3 C core into SPM; `pathToHexMeters` parity between TS and PostGIS; git-lfs models in Xcode Cloud |
| 1 — Walk & conquer | 002, 003, 004, 005 | 7 | 3 testers × 10 real Kaunas walks; two simulated reckonings match expected owners from replayed GPX; battery < 6 %/h; crash-free > 99 % | Battery; background termination; App Store background-mode justification; week-boundary edge cases |
| 2 — Bird capture (end of MVP) | 006 + minimal 009 | 5 | Eval top-1 ≥ 0.75 on common Lithuanian species; device/cloud agreement ≥ 85 %; offline→online flow works; public TestFlight live; MVP metrics tracked in PostHog | BirdNET+ V3 preview drift; Core ML execution-provider op coverage (CPU fallback); microphone permission UX |
| 3 — Plant capture | 007 | 4 | 90 % of test photos decided < 10 s online; queued photos resolve on reconnect | Mid-confidence UX; API quota; duplicate-photo farming |
| 4 — Game layer | 008 | 5 | Reckoning for 10 000 cells < 5 min; App Attest enforced; load test with 200 concurrent walkers passes | Notification fatigue; leaderboard cheating; tile cache invalidation |
| 5 — Release | 009 | 4 | Approved on the App Store; D7 retention and crash-free tracked; non-commercial models removed from the App Store build (the archive contains no model without `appstore` in its manifest `allowed_builds`, ADR 0011) | Review guidelines 5.1.5 / 2.5.4; attribution completeness |
| Post-launch | 010, 011 | 3 + TBD | On-device top-3 ≥ 0.8 on the plant eval set; Android beta reusing the API with fixture parity | Dataset licensing; a third rules implementation to keep in parity |

Post-launch ideas, not scheduled: an underdog multiplier (e.g. ×1.25 metres for a faction owning < 20 % of claimed res-7 cells) — the MVP balances only by pre-selecting the smallest faction at sign-up (`docs/territory-rules.md`).

Total ≈ 27 weeks with three people; assume 32–34 with two.

## Verification strategy (applies to every phase)

- Shared fixtures in `packages/h3-fixtures`: lat/lon → cell + parents; synthetic walk paths → expected metres per cell; multi-week contribution histories → expected strengths and owners; parent aggregation cases. Run by Vitest and XCTest; CI fails on divergence.
- API integration tests with Testcontainers on the production Postgres image; property tests for `finishWalk` idempotency and reckoning idempotency.
- `packages/walk-sim`: GPX replay with jitter, teleport, car speed and no-steps modes; `--finish`; `--reckon <weekId>`; k6 wrapper for load.
- iOS unit tests for path recording, per-hex metres estimation, listening-session aggregation, outbox retry; XCUITests for onboarding, walk start/finish and capture with a stubbed API.
- ML eval sets under `ml/eval` with results committed per model version.
- Weekly field walk in Kaunas; Monday's reckoning reviewed against expectations.
