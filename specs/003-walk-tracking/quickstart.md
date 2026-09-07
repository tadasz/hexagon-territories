# Quickstart: Walk Tracking

**Feature**: `003-walk-tracking` | **Date**: 2026-09-07

How a reviewer or agent verifies each stream and then the whole feature (Constitution V). Commands run from the repository root unless stated. Environment facts: `research.md` R20.

```bash
export SPECIFY_FEATURE=003-walk-tracking SPECIFY_FEATURE_DIRECTORY=specs/003-walk-tracking
export DATABASE_URL=postgres://nature:nature@localhost:5432/nature   # local Postgres 16 + PostGIS; no Docker
```

## A. Stream A — API and walk-sim

### A.1 Build and unit tests

```bash
pnpm install --frozen-lockfile            # Stream C commits the lockfile; A may use `pnpm install` locally
pnpm turbo run build --filter=@nature/walk-sim... --filter=@nature/api...
pnpm --filter @nature/walk-sim test       # gpx/geojson parsing, simulate, expected (oracle), replay against a fake fetch, samples byte-identical
SKIP_DB_TESTS=1 pnpm --filter @nature/api test   # unit: finish pipeline on fixture samples, standing, limits, cursor, schemas
```

Expected: every `walk-paths.json` fixture case run through `apps/api/src/modules/walks/finish.ts`'s pure half gives the fixture's `acceptedSeqs`, `rejected`, `flags`, `distanceM` (±0.5 m) and `hexMeters` (±0.5 m).

### A.2 Sample tracks and the oracle

```bash
pnpm --filter @nature/walk-sim exec walk-sim dry-run packages/walk-sim/samples/azuolynas-loop.gpx --json | head -40
pnpm --filter @nature/walk-sim exec walk-sim dry-run packages/walk-sim/samples/car-a1.gpx --json | jq .flags        # ["teleport","speed","no_steps"]
pnpm --filter @nature/walk-sim exec walk-sim dry-run packages/walk-sim/samples/laisves-aleja-straight.gpx --teleport --json | jq .flags   # ["teleport"]
pnpm --filter @nature/walk-sim samples:generate && git diff --exit-code packages/walk-sim/samples   # byte-identical
```

### A.3 Integration tests (real Postgres)

```bash
pnpm --filter @nature/api db:migrate      # applies 0000–0004 (0003 is 002's)
pnpm --filter @nature/api test            # with DATABASE_URL set: integration suites run
```

Suites and what they prove:

| Suite | Asserts |
|---|---|
| `walks-create.test.ts` | 201 then 200 with the same `walkId` for the same `clientWalkId`; `startedAt` clamped; no faction → 403; stale active walk superseded (finished, reason `superseded`, scored); overlapping → 409 `WALK_OVERLAP` |
| `walks-samples.test.ts` | ≤ 200 enforced (400); re-delivered batch → `stored 0, duplicates n`; reversed batch order → same rows; provisional `accepted`/`rejected` per batch; finished walk → 409; 31st batch in 15 min → 429 `RATE_LIMITED`; daily quota → 429 `SAMPLE_QUOTA_EXCEEDED` |
| `walks-finish.test.ts` | for each sample track: replay via `app.inject` (in order, re-delivered, reversed) then finish → `walk_hex_meters` and `hex_week_contribution` equal `expected()` from `@nature/walk-sim` within 0.05 m and are identical across the three deliveries (SC-001); cap: pre-seeded 1 800 m → `cappedMeters` 200 and row `capped_meters` 2 000; week boundary: samples Sunday 23:50 → Monday 00:05 UTC → `weekId` = Monday's week; `endedAt` clamp; flagged (`car-a1`): `status flagged`, `walk_hex_meters` present, no contribution, no ledger row, `anti_cheat_flags` rows; XP: ledger row `walk_distance`, `users.xp` incremented, daily cap 300; second finish → same summary, no second ledger row; `weekStanding.leader`/`myFactionShare` with seeded `hex_faction_strength`; `INVALID_ENDED_AT` |
| `walks-history.test.ts` | 45 walks → three pages of 20/20/5 newest first, only the owner's; foreign id → 404; `GET /v1/walks/{id}` returns GeoJSON path |
| `walks-autofinish.test.ts` | 13-hour-old active walk finished by the job with `finishReason autofinish` and `endedAt` = last accepted sample; a fresh active walk untouched; second run → `finished 0`; racing client finish returns the stored summary |
| `samples-purge.test.ts` | a partition older than 30 days is dropped, next month ensured, second run no-op |
| `walks-purge-export.test.ts` | 002 FK-coverage test passes; purge removes ledger/flags/contributions/walks/samples/hex meters of the user; export bundle has `walks` and `points` sections |
| `schema.test.ts` (extended) | new columns and index exist |

### A.4 Manual replay against a running API

```bash
pnpm --filter @nature/api dev &                                   # http://localhost:3000
TOKEN=$(...)                                                      # 002: `pnpm --filter @nature/api dev:apple-stub` → sign in → access token
pnpm --filter @nature/walk-sim exec walk-sim replay packages/walk-sim/samples/azuolynas-loop.gpx \
  --base-url http://localhost:3000 --token "$TOKEN" --rate 60 --json | jq '.summary | {weekId, distanceM, hexCount, xp, flags}'
curl -s -H "authorization: Bearer $TOKEN" http://localhost:3000/v1/walks | jq '.items[0]'
pnpm --filter @nature/api job:autofinish                         # exits 0, logs {finished: 0}
```

### A.5 Contract snapshot

```bash
pnpm --filter @nature/api-schema snapshot && pnpm --filter @nature/api-schema test   # stale test green
git diff --stat packages/api-schema/openapi.json                                      # shows the five /v1/walks* operations
```

## B. Stream B — iOS

### B.1 Toolchain (agent container)

```bash
which swift || {  # none preinstalled (R20): install 6.2.1 as 001's Stream C did
  curl -fsSL https://download.swift.org/swift-6.2.1-release/ubuntu2404/swift-6.2.1-RELEASE/swift-6.2.1-RELEASE-ubuntu24.04.tar.gz | tar xz -C "$HOME"
  export PATH="$HOME/swift-6.2.1-RELEASE-ubuntu24.04/usr/bin:$PATH"; }
swift --version                      # Swift version 6.2.1
test -f /usr/include/sqlite3.h       # GRDB links the system SQLite on Linux
```

### B.2 Linux tests

```bash
for p in H3Kit TerritoryRules Core Location Persistence; do (cd apps/ios/Packages/$p && swift test -Xswiftc -warnings-as-errors) || exit 1; done
grep -rl 'import UIKit\|import SwiftUI\|import CoreLocation\|import CoreMotion' apps/ios/Packages/Location/Sources apps/ios/Packages/Persistence/Sources | grep -v '/Platform/'   # no output
```

What the `Location` tests prove (SC-002): `PathRecorderTests` — for all six `walk-paths.json` cases, feeding the samples as fixes yields exactly the fixture's `acceptedSeqs` and `rejected`; `HexMetersEstimatorTests` — incremental estimate equals `pathToHexMeters(rawAccepted)` (±0.5 m) for all cases and equals the fixture `hexMeters` for `straight-line`, `teleport`, `car-speed`; `AutoPauseDetectorTests` — 180 s without a ≥ 10 m move pauses, first move resumes, moving time excludes the pause; `WalkTrackerTests` — `FakeLocationSource` + `FakeClock`: idle → recording on `start`, samples reach the `WalkStore`, 6 h → finishing, `stop` → finished with `endedAt`, relaunch recovery from a store with a recording walk.

What the `Persistence` tests prove: migration applies on an in-memory `DatabaseQueue`; walk/sample/path round-trips; outbox FIFO per walk and interleaving; `Backoff` schedule `2, 4, 8 … 300 s` ±20 %; `SyncCoordinatorTests` with a fake `WalksService`: create → samples → finish delivered in order, network error retried, 429 waits `retryAfterS`, `WALK_OVERLAP` marks the walk failed and drops its items while the next walk proceeds, `WALK_NOT_ACTIVE` on samples drops the walk's remaining items, finish success stores the summary; `VacuumTests` — samples of synced walks older than 7 days deleted, paths kept.

### B.3 Parse-only checks and the project file

```bash
for f in $(git ls-files 'apps/ios/Packages/WalkFeature/**/*.swift' 'apps/ios/Packages/Location/Sources/Location/Platform/*.swift' 'apps/ios/NatureExplorer/*.swift'); do swiftc -parse -swift-version 6 "$f" || exit 1; done
yq '.packages | keys' apps/ios/project.yml                     # includes Location, Persistence, WalkFeature
plutil -lint apps/ios/NatureExplorer/Info.plist 2>/dev/null || python3 -c "import plistlib;d=plistlib.load(open('apps/ios/NatureExplorer/Info.plist','rb'));print(d['UIBackgroundModes'], 'NSLocationWhenInUseUsageDescription' in d, 'NSMotionUsageDescription' in d)"
```

### B.4 macOS / Xcode Cloud (record in `apps/ios/VERIFY.md`)

```bash
cd apps/ios && apps/ios/scripts/sync-openapi.sh && xcodegen generate
xcodebuild test -scheme NatureExplorer -destination 'platform=iOS Simulator,name=iPhone 16'
# Simulator: Features > Location > City Run; Walk tab → Start → HUD counts, hex changes, Stop → summary sheet (needs the API + a signed-in tester)
# Simulator: Freeway Drive → finish → "flagged" banner
# Airplane mode: Start → Stop → "pending upload"; disable airplane mode → history row updates to the server summary
# Device (iPhone 13): 1-hour walk with the screen off; Settings > Battery shows < 6 %; xctrace Energy Log attached (SC-006)
```

## C. Stream C — Integration (after A and B are merged)

```bash
pnpm install && git add pnpm-lock.yaml
pnpm lint && pnpm typecheck && pnpm test                     # SKIP_DB_TESTS=1 path green
DATABASE_URL=… pnpm test:db                                  # integration suites green
pnpm --filter @nature/api-schema snapshot && apps/ios/scripts/sync-openapi.sh && pnpm --filter @nature/api-schema test
git diff --exit-code packages/api-schema/openapi.json apps/ios/Packages/APIClient/Sources/APIClient/openapi.json
grep -n 'walk.autofinish\|samples.purge\|300 XP\|8 640\|30 batches' docs/architecture.md   # numbers documented
.specify/scripts/bash/check-prerequisites.sh --require-tasks  # then /speckit-analyze → analysis.md, /speckit-converge
```

## Verification log

| Date | Commit | Stream | Environment | Result |
|---|---|---|---|---|
| — | — | — | — | filled by the implementing agents (A.1–A.5, B.1–B.4, C) |
