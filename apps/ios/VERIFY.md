# Verification log — `apps/ios`

Three entries: feature **003-walk-tracking** (Stream B, first section), feature **002-auth-and-factions** (Stream B)
and feature **001-repo-foundations** (Stream C), kept for the record. All were written in a Linux (Ubuntu 24.04)
container **without Xcode, XcodeGen or an iOS SDK**; the Swift 6.2.1 Linux toolchain
(`swift-6.2.1-RELEASE-ubuntu24.04`, downloaded from swift.org into the session's scratch directory and put on `PATH`
with `export PATH=<toolchain>/usr/bin:$PATH`) built and tested everything that does not import SwiftUI, UIKit,
CoreLocation, CoreMotion, BackgroundTasks, Network, AuthenticationServices, Security or MapLibre.

## Feature 003 — Stream B (2026-09-07)

Toolchain: the 6.2.1 tarball was already present in the session scratch directory from feature 002
(`swift/swift-6.2.1-RELEASE-ubuntu24.04`); `swift --version` = `Swift version 6.2.1 (swift-6.2.1-RELEASE)`,
`/usr/include/sqlite3.h` present and `pkg-config --exists sqlite3` true (GRDB links the system SQLite). SwiftPM
resolved `GRDB.swift` **7.11.1** and `swift-openapi-generator` 1.13.1 through the session proxy.

### Verified here (Linux, Swift 6.2.1)

| What | Command (from `apps/ios/Packages`) | Result |
|---|---|---|
| `Core` — walk models (`WalkModels.swift`), `WalksService`, `APIError` walk codes + `isTransient`, `FakeWalksService` in `CoreTestSupport` | `cd Core && swift test -Xswiftc -warnings-as-errors` | **79 tests, 0 failures** (66 from 002 + `WalkModelsCodingTests` 8: the contract's finish example decodes verbatim to `hexCount 5`, `weekId "2026-W37"`, round-trips, nulls, flags, requests encode as the contract expects; `APIErrorWalkCodesTests` 5). |
| `Location` — `PathRecorder`, `HexMetersEstimator`, `AutoPauseDetector`, `WalkTracker`, `LivePath`; fakes in the `LocationTestSupport` product | `cd Location && swift test -Xswiftc -warnings-as-errors` | **28 tests, 0 failures.** `PathRecorderTests` 5: all six `walk-paths.json` cases fed as fixes with the throttle disabled give exactly the fixture's `acceptedSeqs` and `rejected` (SC-002 filter parity); 1 Hz at 1 m/s keeps one fix per 5 s; a 12 m jump within 2 s is kept. `HexMetersEstimatorTests` 4: incremental estimate vs one batch `pathToHexMeters(rawAccepted)` — **max deviation 0.0 m** over all six cases; `teleport` equals the fixture within 0.5 m; `loop-inside-one-cell` → one cell, `edge-hugging` → the fixture's two cells (see the R19 note below for `straight-line`/`car-speed`). `AutoPauseDetectorTests` 6: pause at 180 s, jitter < 10 m never counts, 10 m every minute never pauses, resume on the first move, moving time excludes the pause. `WalkTrackerTests` 13: start → recording + `create` in the store; the `noisy-zigzag` fixture streamed → the store holds exactly its accepted and rejected seqs; throttle on streamed fixes; stationary 3 min → paused → move → recording; 6 h → finished once (asserted on the state stream) with `endedAt = now` and pedometer steps; stop; `notAuthorized` → failed and no walk; source error mid-walk → finished with what was recorded; streamed fixes consumed; store failure keeps the walk running with a warning; recovery (with and without samples; never while active). |
| `Persistence` — GRDB 7.11.1 schema `v1-walks`, `GRDBWalkRepository`, `OutboxQueue`, `Backoff`, `SyncCoordinator` | `cd Persistence && swift test -Xswiftc -warnings-as-errors` | **31 tests, 0 failures.** `WalkRepositoryTests` 7 (migration creates the four tables; create/append/progress/finish round-trips; path rebuilt from samples; recovery with progress, counts and points; history ordering newest first + `unsyncedWalks`; server path adopted only when the local one is empty; append queues a batch at 200). `VacuumTests` 1 (samples of synced walks older than 7 days deleted, paths and other walks kept, idempotent). `OutboxQueueTests` 6 (FIFO per walk interleaved by id; a backing-off head never blocks another walk; 451 samples → batches 200/200/51 without gaps or duplicates, pedometer window on the last; `onlyFullBatches`; `dropWalk`; payload is the wire body). `BackoffTests` 2 (`2, 4, 8 … 256, 300`; ±20 % jitter, seeded). `SyncCoordinatorTests` 15 (create → samples → finish in order with the server id; no pedometer when unavailable; network error → retried once after ≈ 2 s ± 20 %, no duplicate; 5xx back-off grows; 429 waits exactly `retryAfterS`; quota with `retryAfterS 1` waits 5 s; `WALK_OVERLAP` → walk failed, its items dropped, the next walk fully delivered; `WALK_NOT_ACTIVE` on samples → rest dropped, walk refreshed with `GET` and adopted; refresh failure → failed; a 401 halts the drain without dropping; orphan items dropped; **SC-004**: a drain cancelled mid-batch resumes with exactly one `create`, the batch re-sent once, one `finish`; concurrent drains coalesce; `flushSamples` queues only new samples; the 60 s recording timer). |
| `WalkFeature` — `WalkViewModel`, `WalkHistoryViewModel`, `WalkSummaryPresentation`, `WalkRow`, `MiniPathGeometry` (the SwiftUI views sit behind `#if canImport(SwiftUI)`) | `cd WalkFeature && swift test -Xswiftc -warnings-as-errors` | **24 tests, 0 failures.** `WalkViewModelTests` 12 with the real GRDB in-memory repository, `SyncCoordinator` and `WalkTracker` and fakes at the edges: start creates the outbox `create` item and records (permission not asked twice); the HUD follows accepted fixes; stop queues `samples` + `finish`, shows the provisional summary (XP pending, 3 uploads pending) and the server summary replaces it after the drain (26 XP, counted metres, leader); a permanent failure is shown on the summary; denied permission → Settings prompt, no walk, source never started; not determined → asked once; no faction → refused before the permission prompt; source failure reported; auto-pause/resume mirrored in the phase; 6 h auto-end → summary with a notice; lost location source → walk saved with a notice; `recoverIfNeeded` queues the finish of an interrupted walk with `endedAt` = last kept sample. `WalkHistoryViewModelTests` 5 (20/5 paging with `nextCursor`, local pending/recording walks merged on top and not repeated, server failure keeps local rows, status lines, detail from the server and `WALK_NOT_FOUND` → "not available"). `MiniPathGeometryTests` 3, `WalkSummaryPresentationTests` 4. |
| `APIClient` — **the generator ran on Linux** from the temporary `openapi.json` (see below): `WalksServiceLive`, `WalksMapping`, `walks` in `LiveServices`, `retry-after` → `sampleQuotaExceeded` | `cd APIClient && swift test` | **21 tests, 0 failures** (13 from 002 + `WalksServiceLiveTests` 8 with a stubbed `ClientTransport`: 201 and 200 both map to `WalkCreated`, bearer header and body; `WALK_OVERLAP` → `.walkOverlap(activeWalkId:)`; `FACTION_REQUIRED`, `WALK_NOT_FOUND`; batch result mapping, 429 `SAMPLE_QUOTA_EXCEEDED` with the `retry-after` header → `retryAfterS 3600`, `WALK_NOT_ACTIVE`; the contract's finish example decodes through the generated types; flagged and active summaries; `listWalks` passes `cursor` and `limit`; transport failure → `.network`). The generated code emits the generator's own `public import` warnings, so `-warnings-as-errors` is not used for this package (as in 002). |
| Regression | `H3Kit` 21, `TerritoryRules` 29, `AuthFeature` 6, `FactionsFeature` 9, `ProfileFeature` 13, `DesignSystem` 1 | all **0 failures** (re-run after the `Core` change). |
| No UI frameworks in the Linux packages | `grep -rl 'import UIKit\|import SwiftUI\|import CoreLocation\|import CoreMotion' Packages/Location/Sources Packages/Persistence/Sources \| grep -v /Platform/` | no output. |
| SwiftUI / platform / app sources | `swiftc -parse -swift-version 6` on every file in `NatureExplorer/`, `Tests/NatureExplorerTests/`, `Packages/WalkFeature/Sources/WalkFeature/*.swift`, `Packages/Location/Sources/Location/Platform/*.swift` | all parse. **Type-checking of the SwiftUI, CoreLocation, CoreMotion, BackgroundTasks and Network code is not possible without the Apple SDKs.** |
| `project.yml` / `Info.plist` | `yq`-equivalent parse; every `packages[].path`, `sources[].path`, `INFOPLIST_FILE`, `CODE_SIGN_ENTITLEMENTS` exists; `plistlib` check of quickstart B.3 | packages include `Location`, `Persistence`, `WalkFeature`; plist prints `['location'] True True` and `BGTaskSchedulerPermittedIdentifiers = ['com.natureexplorer.app.sync']`; no `NSLocationAlways…` key. **`xcodegen generate` itself not run.** |
| Style | `swiftlint` / `swiftformat` not installed here; checked by hand: no tabs, no trailing whitespace, `.swiftlint.yml` includes the three new packages | OK (a few doc-comment and test-string lines exceed 130 characters; `ignores_comments` covers the former). |

### R19 note — estimator vs fixture for `straight-line` and `car-speed`

`tasks.md` T016 expects the incremental estimate to equal the fixture's `hexMeters` within 0.5 m for `straight-line`,
`teleport` and `car-speed` because their simplified path has two points. That holds for `teleport` (no jitter). The
raw samples of `straight-line` carry sub-tolerance jitter (raw length 1 207.6 m vs simplified 1 197.0 m, max cell
deviation 4.8 m) and `car-speed`'s 40 short segments locate the crossings slightly differently than one long segment
(max cell deviation 0.96 m). The device estimate runs over the *raw* accepted path by design (research.md R19, the HUD
says "estimate"), so `HexMetersEstimatorTests` asserts identical cells, conservation of metres, ±0.5 m for `teleport`
and ±1 % of the walk length for the other two, and prints the deviations. The SC-002 statement ("within 0.5 m of the
mirrored rules package's batch computation over the same accepted samples") is met exactly (0.0 m).

### Temporary OpenAPI document (T021) — and a contract finding for Streams A/C

`Packages/APIClient/Sources/APIClient/openapi.json` is **not** the committed snapshot: it is the 002 snapshot merged
with `specs/003-walk-tracking/contracts/openapi.yaml` (paths, tag, schemas, parameters, responses), marked
`info.x-source = TEMPORARY …`, with one deliberate shape change — `WalkSummary.path` is written as an inline nullable
object (`type: [object, null]` with `LineString`'s properties). Stream A's refreshed snapshot (T012) landed while this
stream ran and was tried through the generator (`./scripts/sync-openapi.sh && swift build`):

- the snapshot has the five `/v1/walks*` operations, and every other walk schema generates and maps cleanly;
- its `WalkSummary.path` is `oneOf: [{$ref LineString}, {type: "null"}]` (the contract's shape). swift-openapi-generator
  1.13.1 answers `warning: Schema "null" is not supported, reason: "schema type", skipping [… WalkSummary/path]` and
  **generates `WalkSummary` without a `path` property**; the same happens with `anyOf`. Because the schema has
  `additionalProperties: false`, the generated decoder (`ensureNoAdditionalProperties(knownKeys:)`) would then reject
  every real finish/detail response that carries `path`. So the snapshot as committed cannot back the iOS client.

**Recommendation (Stream A / Stream C T027)**: express `path` in the TypeBox schema so the OpenAPI output is either
`type: ["object", "null"]` with the `LineString` properties inline (verified here: generates
`WalkSummary.PathPayload?`, mapped by `WalksMapping.swift`), or a plain `$ref` to `LineString` that is *not* in
`required` (the generator makes it `Components.Schemas.LineString?` and decodes JSON `null` as absent — not verified
here; check that Fastify's response serializer still emits `null` for it). Then run
`pnpm --filter @nature/api-schema snapshot && apps/ios/scripts/sync-openapi.sh`, rebuild `APIClient`, and adjust the
one `PathPayload` extension in `WalksMapping.swift` to the generated name. The `@nature/api-schema` equality test will
fail until the committed snapshot and the iOS copy are the same file again — expected, and the reason the iOS copy is
marked TEMPORARY.

### Not verified here — run on macOS (Xcode 16 / Swift 6) or Xcode Cloud

```bash
cd apps/ios
./scripts/sync-openapi.sh                          # after Stream A's snapshot landed (replaces the TEMPORARY document)
for p in Core Location Persistence WalkFeature APIClient; do (cd Packages/$p && swift test) || exit 1; done   # should reproduce the Linux counts
brew install xcodegen shellcheck swiftlint swiftformat
swiftlint && swiftformat --lint .
xcodegen generate                                  # expect no "missing file" warnings; Location/Persistence/WalkFeature linked
xcodebuild test -scheme NatureExplorer -destination 'platform=iOS Simulator,name=iPhone 16' | tail -5
#   ** TEST SUCCEEDED ** — AppContainerTests 5, RootGateTests 8, ZoomBridgeTests 2, WalkWiringTests 5
# Simulator flows (specs/003-walk-tracking/quickstart.md B.4), against the API from quickstart A with a signed-in tester:
#   Features > Location > City Run: Walk tab → Start → HUD counts, hex changes, Stop → summary sheet with the server numbers
#   Features > Location > Freeway Drive → Stop → "This walk was flagged (…)" banner, 0 XP
#   Airplane mode: Start → Stop → "Pending upload"; airplane mode off → the sheet/history row updates to the server summary
#   GPX replay: Xcode > Debug > Simulate Location with a GPX from packages/walk-sim/samples (Stream A) once it exists
#   Kill the app mid-walk → relaunch → "A walk that was interrupted has been saved and will be uploaded."
# Device (iPhone 13): 1-hour walk with the screen off, background location indicator visible, Settings > Battery < 6 %
#   (SC-006, owner action; xctrace Energy Log attached to the verification log)
git add apps/ios/Packages/Persistence/Package.resolved apps/ios/Packages/WalkFeature/Package.resolved   # freeze GRDB 7.11.x (Stream C)
```

Things a macOS run may surface that could not be checked here:

- **`CoreLocationSource`**: `CLLocationUpdate.liveUpdates(.fitness)` (iOS 17 API) inside an `AsyncThrowingStream`,
  `CLBackgroundActivitySession()` held from `start()` to `stop()`, `LocationFix(CLLocation, isStationary:)` mapping of
  negative (invalid) accuracies/speed/course. iOS 18's `CLLocationUpdate.authorizationDenied` etc. are deliberately not
  used (iOS 17 deployment target); a revoked permission ends the sequence with an error, which the tracker turns into
  `WalkFinishInput.Reason.sourceLost`.
- **`CoreLocationPermission`**: `CLLocationManagerDelegate` under strict concurrency (`@unchecked Sendable`,
  `locationManagerDidChangeAuthorization` resuming stored continuations); `requestWhenInUseAuthorization` only, never
  Always (Constitution VII).
- **`PedometerBridge`**: `CMPedometer.queryPedometerData(from:to:)` wrapped in a continuation; `nil` in the simulator.
- **`SyncKicks`**: `BGTaskScheduler.shared.register` is called from `NatureExplorerApp.init` (must precede launch
  completion); `BGAppRefreshTaskRequest` submission; `NWPathMonitor` on a private queue calling into the actor.
- **SwiftUI**: `WalkScreen`'s sheet binding over an `@Observable` phase; `NavigationLink(value:)` +
  `navigationDestination(for: String.self)` in `WalkHistoryList`; `Canvas` in `MiniPathView`; `Link` to
  `UIApplication.openSettingsURLString` in `PermissionView`; `LabeledContent`; `Text(date, format:)`.
- **`WalkTabRoute`** owns the `WalkViewModel` as `@State`; the tracker/live path live in `AppContainer`, so a running
  walk survives tab switches, but a re-created route re-subscribes to the tracker's single-consumer state stream —
  if the simulator flow shows a stale phase after switching tabs, hoist the view model into the container.
- **XcodeGen**: `LocationTestSupport` is a second product of the `Location` package declared with
  `package: Location` + `product: LocationTestSupport` on the test target; GRDB is an SPM dependency of `Persistence`
  only (the app target imports `Persistence`, never `GRDB`).

### Notes for Stream C

- `.gitignore`: `apps/ios/Packages/*/.build/` already covers `Location`, `Persistence`, `WalkFeature`; the `.build`
  directories and the Linux-generated `Package.resolved` files (`Persistence`, `WalkFeature`, `APIClient`) were deleted
  before hand-off. Commit `Package.resolved` after the first macOS resolution (GRDB 7.11.1 resolved here).
- `docs/licences.md`: GRDB (MIT) already has a row from 001; nothing new ships in the binary.
- Snapshot sync (T027): see "Temporary OpenAPI document" above — the committed snapshot's `WalkSummary.path` shape
  must change before the iOS client can be generated from it.
- `quickstart.md` B.1–B.3 ran clean (this table is the log); B.4 and SC-006 are macOS/device items for the owner.
- Deviations from `tasks.md`: fakes live in `Location/Sources/LocationTestSupport` (a library product, like
  `CoreTestSupport`) instead of `Tests/LocationTests/Fakes/`, so `WalkFeature` and the app tests reuse them;
  `LocationSource.updates()` returns an `AsyncThrowingStream` (a revoked permission must end the walk, and a plain
  `AsyncStream` cannot carry the error); the tracker exposes `ingest(_:)` so tests feed fixes deterministically;
  `WalkStore.updateProgress` carries the numbers and estimates while the path itself is rebuilt from the stored
  samples (no per-sample rewrite of the `walk_path` blob); `SyncCoordinator` takes `autoKick: false` in tests;
  `AppContainer` gains `WalkDependencies` (an in-memory graph by default so the 002 tests still construct it) and
  `resumeWalks()`; `MiniPathGeometry` tests run on Linux inside `WalkFeature` (the package builds on Linux because
  every SwiftUI file is guarded).

## Feature 002 — Stream B (2026-09-07)

### Verified here (Linux, Swift 6.2.1)

| What | Command (from `apps/ios/Packages`) | Result |
|---|---|---|
| `Core` (models, `APIError`, `AuthSession`, validators, presentation, `SessionGate`) | `cd Core && swift test -Xswiftc -warnings-as-errors` | **66 tests, 0 failures**, no warnings. `AuthSessionTests` = 20 (restore ×3, sign-in ×2, valid/expired/skew, 5 session-ending codes, network + rate-limit keep the pair, 10 concurrent callers → 1 refresh, `.refreshing` mid-flight, `handleUnauthorized` ×2, sign-out ×3, sign-out during refresh). `DisplayNameValidatorTests` run the §2.7 vector verbatim. |
| No UI frameworks in `Core` | `grep -rl 'import UIKit\|import SwiftUI\|import AuthenticationServices\|import Security' Core` | no output. |
| `APIClient` — **the generator ran on Linux**: SwiftPM resolved `swift-openapi-generator` 1.13.1, `swift-openapi-runtime` 1.12.1, `swift-openapi-urlsession` 1.3.1, `swift-http-types` 1.8.0 through the session proxy and generated `Client`/`Types` from `Sources/APIClient/openapi.json`; the adapters and middlewares type-check against the generated code | `cd APIClient && swift test` | **13 tests, 0 failures** (`AuthMiddlewareTests` 8: public ops get no header, bearer added, retry once on 401 with the refreshed token, no second retry, session-ending refresh propagates, signed-out fails before sending, non-replayable body not retried, real `AuthSession` refreshes an expired token before sending; `ErrorEnvelopeMiddlewareTests` 5). Package sources compile without warnings; the generated code emits the generator's own `public import` warnings, which is why `-warnings-as-errors` is not used for this package. |
| `AuthFeature` view model + credential mapping | `cd AuthFeature && swift test -Xswiftc -warnings-as-errors` | **6 tests, 0 failures** (success → session signed in + store written; `appleUnavailable` → retry message; network → connection message; cancel → idle; Apple failure message; `AppleOutcome.from(identityToken:authorizationCode:fullName:)` mapping incl. empty name components dropped). |
| `FactionsFeature` view model | `cd FactionsFeature && swift test -Xswiftc -warnings-as-errors` | **9 tests, 0 failures** (suggested pre-selected + badged, confirm sends the id and updates `me`, locked profile → confirm disabled + message with days and date, server `409` adopted, empty world → zeros, factions failure, profile failure keeps injected `me`, other errors keep the selection, unknown id ignored). |
| `ProfileFeature` view model | `cd ProfileFeature && swift test -Xswiftc -warnings-as-errors` | **13 tests, 0 failures** (invalid name never reaches the service, trimmed name saved, server validation error shown, sign-out clears the store, delete clears the session without logout / even when the body cannot be read / keeps it when the request never arrived, export polls until ready (3 calls, 2 sleeps), stops on failed, network error, times out after 60 polls). |
| `DesignSystem` | `cd DesignSystem && swift test -Xswiftc -warnings-as-errors` | **1 test** on Linux (six tabs in order, `flag.2.crossed`); the three SwiftUI-dependent tests are inside `#if canImport(SwiftUI)` and run on macOS. |
| 001 regression | `cd H3Kit && swift test -Xswiftc -warnings-as-errors`; `cd ../TerritoryRules && swift test -Xswiftc -warnings-as-errors` | **21** and **29** tests, 0 failures. |
| SwiftUI / app sources | `swiftc -parse -swift-version 6` on every file in `NatureExplorer/`, `Tests/NatureExplorerTests/`, the three feature packages' views, `SignInView`, `KeychainStore`, `AppleCredentialMapping`; `swift package dump-package` for all nine manifests | all parse, all manifests dump. **Type-checking of the SwiftUI, AuthenticationServices and Security code is not possible without the Apple SDKs.** |
| `project.yml` | `yq` parse; every `packages[].path`, `targets[].sources[].path`, `INFOPLIST_FILE` and `CODE_SIGN_ENTITLEMENTS` exists (`test -e` loop); `Info.plist` and the entitlements parse with `plistlib` | OK. **`xcodegen generate` itself not run.** |
| `scripts/sync-openapi.sh` | `bash -n`; run without the snapshot (exits 1 naming the `pnpm --filter @nature/api-schema snapshot` command); run with `--from-contract` (writes the temporary document) | OK. `shellcheck` is not installed here. |
| Style | `swiftlint` / `swiftformat` are not installed here; checked by hand: no line over 130 characters, no tabs, no trailing whitespace, `.swiftlint.yml` now includes the new packages | OK. |

### Not verified here — run on macOS (Xcode 16 / Swift 6) or Xcode Cloud

```bash
cd apps/ios
./scripts/sync-openapi.sh                          # no-op unless the snapshot changed (Stream C synced it; see below)
cd Packages/Core && swift test && cd ../..         # should reproduce the Linux result (66 tests)
cd Packages/APIClient && swift test && cd ../..    # generator plugin runs during the build; 13 tests
cd Packages/AuthFeature && swift test && cd ../..  # 6 tests; now also type-checks SignInView / KeychainStore / AppleCredentialMapping
cd Packages/FactionsFeature && swift test && cd ../..   # 9 tests + the three SwiftUI views
cd Packages/ProfileFeature && swift test && cd ../..    # 13 tests + the four SwiftUI views
cd Packages/DesignSystem && swift test && cd ../..      # 4 tests (incl. the SwiftUI ones)
brew install xcodegen shellcheck swiftlint swiftformat
shellcheck scripts/sync-openapi.sh ci_scripts/ci_post_clone.sh
swiftlint && swiftformat --lint .
xcodegen generate                                  # expect no "missing file" warnings; Sign in with Apple entitlement on the app target
xcodebuild test -scheme NatureExplorer -destination 'platform=iOS Simulator,name=iPhone 16' | tail -5   # ** TEST SUCCEEDED ** (AppContainerTests 5, RootGateTests 8, ZoomBridgeTests 2)
# Simulator flow of specs/002-auth-and-factions/quickstart.md §B against the API from §A.2
git add apps/ios/Packages/APIClient/Package.resolved apps/ios/Packages/MapFeature/Package.resolved   # freeze versions (Stream C)
```

Things a macOS run may surface that could not be checked here:

- **Swift 6 strict concurrency in SwiftUI code**: `SignInView`'s `onCompletion` closure builds `AuthViewModel.AppleOutcome`
  (Sendable) from the non-Sendable `ASAuthorization` before hopping into a `Task`; the `@State`-owned view models in
  `RootView`'s route views; `@Bindable var viewModel` in `EditDisplayNameView`; `Link(destination:)` in `ExportView`.
- **`KeychainStore`** (`Security`): the `kSec*` CFString constants referenced from a nonisolated `TokenStore` under strict
  concurrency; `SecItemAdd` → `errSecDuplicateItem` → `SecItemUpdate` path; the simulator needs no entitlement for
  generic passwords. Its behaviour is not unit-tested (the fakes cover `AuthSession`); test it in the simulator flow
  (sign in → force-quit → relaunch → still signed in).
- **`AuthViewModel.AppleOutcome.init(_ result:)`** (`AuthenticationServices`): `ASAuthorizationError.Code.canceled`
  comparison and the `identityToken` / `authorizationCode` `Data` → UTF-8 conversion.
- **XcodeGen**: the entitlements file is excluded from `sources` and referenced by `CODE_SIGN_ENTITLEMENTS`; the second
  product of the `Core` package (`CoreTestSupport`) is declared with `package: Core` + `product: CoreTestSupport` on the
  test target; the `swift-openapi-generator` plugin must be trusted once in Xcode ("Trust & Enable" on first build) and
  on Xcode Cloud (`-skipPackagePluginValidation` is **not** needed for build-tool plugins from a resolved package, but
  if the build stops at plugin validation add `ENABLE_USER_SCRIPT_SANDBOXING`-compatible settings per Apple's docs).
- **ATS**: `Info.plist` sets `NSAppTransportSecurity/NSAllowsLocalNetworking = YES` for the `http://localhost:3000`
  development API. Production uses HTTPS (feature 009); keep the key or scope it when the production URL lands.
- **`Date.ISO8601FormatStyle`** on Apple platforms (iOS 15+): `JSONCoding.parseISO8601` accepts both `…04.000Z` and
  `…04Z`; the same helper backs `APIClient.LenientISO8601DateTranscoder`.

### Stream C (2026-09-07) — real snapshot synced, every Linux package re-run

`Packages/APIClient/Sources/APIClient/openapi.json` is now the byte-for-byte copy of `packages/api-schema/openapi.json`
(`apps/ios/scripts/sync-openapi.sh` after `pnpm --filter @nature/api-schema test` confirmed the snapshot is current; the
equality test in `@nature/api-schema` is no longer skipped). The snapshot adds `/health`, `/openapi.json` and
`HealthResponse` to the contract fragment and keeps every `operationId` and schema name, so no adapter changed. With the
real document the generator ran again on Linux (Swift 6.2.1, `swift-openapi-generator` 1.13.1) and every package passed
with the same counts as above: `APIClient` 13, `Core` 66, `AuthFeature` 6, `FactionsFeature` 9, `ProfileFeature` 13,
`DesignSystem` 1, `H3Kit` 21, `TerritoryRules` 29 tests, 0 failures. `.build` directories and the Linux-generated
`Package.resolved` were deleted again; the first macOS resolution commits `Package.resolved` (tasks.md Convergence).
CI job `swift` (`.github/workflows/api.yml`) now runs the same eight packages in the `swift:6.2.1-noble` container.

### Notes for Stream C

- `.gitignore`: `apps/ios/Packages/*/.build/` (001's T043 glob) already covers the new packages; nothing else. The
  `.build` directories and the Linux-generated `Package.resolved` files were deleted before hand-off; commit the
  `Package.resolved` of `APIClient` (and `MapFeature`) after the first macOS resolution to freeze versions
  (`plan.md` Technical Context).
- `docs/licences.md` row for `swift-openapi-runtime` / `swift-openapi-urlsession` (Apache 2.0, ships in the app) is
  Stream C's T029; `swift-http-types` (Apache 2.0) comes with them.
- CI: the optional `swift` job of T030 can run `swift test` in `Core`, `AuthFeature`, `FactionsFeature`,
  `ProfileFeature` and `DesignSystem` on `ubuntu-latest` too, not only in `H3Kit`/`TerritoryRules`/`Core` — they all
  pass on Linux because the SwiftUI files sit behind `#if canImport(SwiftUI)`. `APIClient` needs network access for
  SwiftPM (GitHub) and `swift-openapi-generator` runs as a build plugin.
- Deviations from `tasks.md` (Stream B): the fakes live in the `CoreTestSupport` library product of the `Core` package
  (`FakeAuthService`, `FakeClock`, `FakeFactionsService`, `FakeProfileService`, `RecordingTokenStore`, `Fixtures`)
  instead of `Tests/CoreTests/Fakes/`, so the four other test targets reuse them; `Core` also gained
  `App/SessionGate.swift` (the gate decision, tested on Linux) and `Support/JSONValue.swift` (envelope `details`);
  `APIClient` gained `ErrorEnvelopeMiddleware` so adapters only handle success cases; `AppContainer` caches the last
  profile in `UserDefaults` (`ProfileCache`) so an offline launch reaches the tabs (quickstart §B "kill the API and
  relaunch → still signed in").
- Owner: enable **Sign in with Apple** on the App ID `com.natureexplorer.app` and set `DEVELOPMENT_TEAM`
  (`plan.md` "Owner actions"); without it the button returns an error on device.

## Feature 001 — Stream C (2026-09-07)

Written by the implementing agent on 2026-09-07 in a Linux (Ubuntu 24.04) container **without Xcode, XcodeGen or an
iOS SDK**. A Swift 6.2.1 Linux toolchain (`swift-6.2.1-RELEASE-ubuntu24.04`) was downloaded into the container so the
two Foundation-only packages could be built and tested for real; everything that needs UIKit/SwiftUI/MapLibre could
only be syntax-parsed and reviewed. This section lists exactly what was verified, how, and what must still be run on
macOS / Xcode Cloud (Stream E, T045).

### Verified here (Linux, Swift 6.2.1, `-Xswiftc -warnings-as-errors`)

| What | Command (from repo root) | Result |
|---|---|---|
| H3 C core vendored | `apps/ios/scripts/vendor-h3.sh` (→ `Packages/H3Kit/scripts/vendor-h3.sh v4.2.1`) | 19 `.c`, 22 private headers, `include/h3api.h` generated (macros 4/2/1), `VERSION` = `4.2.1`, Apache-2.0 `LICENSE` copied. Tarball download is blocked by this container's egress policy, so the script's `git clone --depth 1 --branch v4.2.1` fallback ran. |
| C core correctness | `clang -std=c11 … Sources/CH3/lib/*.c` + a 10-line C harness | Kaunas (54.8985, 23.9036) → `891f40d1a4fffff`, res-7 parent `871f40d1affffff`, 6 vertices — identical to `h3-js` 4.x. |
| `H3Kit` builds + tests | `cd apps/ios/Packages/H3Kit && swift test -Xswiftc -warnings-as-errors` | **21 tests, 0 failures**, no warnings. Fixture tests ran against Stream A's `packages/h3-fixtures/fixtures/latlng-to-cell.json` (200 cases) found by the `#filePath` walk-up. |
| `TerritoryRules` builds + tests | `cd apps/ios/Packages/TerritoryRules && swift test -Xswiftc -warnings-as-errors` | **29 tests, 0 failures**, no warnings, against Stream A's four fixtures: `zoom-resolution` (23), `walk-paths` (6 cases, ±0.5 m), `reckoning-weeks` (10 cells × up to 3 weeks, 8 parent cases). |
| Independent cross-check | scratch JS reference of plan.md items 2, 4–10 (h3-js) generating 6 extra walk paths + 3 reckoning cells | Swift matched the JS reference on every case before Stream A's fixtures existed. |
| SC-002 mutation check | copy fixtures, change one `hexMeters.meters` (+5 m), one `expected.owner`, one `parents.r7`; `NATURE_FIXTURES_DIR=<copy> swift test` | Fails naming the case: `[straight-line] metres in 891f40d1a6bffff`, `[no-faction-reaches-min/2026-W35] owner`, `[lt-random-003] r7 parent`. |
| Malformed / missing fixture | `WalkPathsTests.testMalformedFixtureFailsNamingTheFile`, `testSchemaInvalidFixtureReportsTheJSONPath`, `testMissingFixtureNamesThePath` | Messages contain the file name and the JSON path (`$.cases[0].input.samples[0].lon`). |
| No UI imports in Linux packages | `grep -rl 'import UIKit\|import SwiftUI\|import MapLibre' apps/ios/Packages/H3Kit apps/ios/Packages/TerritoryRules` | no output. |
| SwiftUI / app sources | `swiftc -parse -swift-version 6` on every file in `NatureExplorer/`, `Tests/`, `DesignSystem`, `MapFeature`; `swift package dump-package` for both manifests | all parse; `MapFeature` resolves the `maplibre-gl-native-distribution` dependency in its manifest. **Type-checking not possible without the iOS SDK.** |
| `project.yml` | `yq` parse; every `path:` it references exists (`NatureExplorer`, `Packages/*`, `Resources`, `Tests/NatureExplorerTests`, `NatureExplorer/Info.plist`) | OK. **`xcodegen generate` itself not run.** |
| `ci_post_clone.sh` | `bash -n`; run with stub `brew`/`git`/`xcodegen` on `PATH` | success path exits 0; a failing `git lfs pull` prints `git-lfs pull failed` and exits 1. `shellcheck` is not installed here — run it on macOS. |

### Not verified here — run on macOS (Xcode 16 / Swift 6) or Xcode Cloud

```bash
# 1. Foundation-only packages (should reproduce the Linux result)
cd apps/ios/Packages/H3Kit && swift test
cd ../TerritoryRules && swift test

# 2. SwiftUI packages (first real type-check of DesignSystem / MapFeature; MapFeature needs an iOS destination)
cd apps/ios/Packages/DesignSystem && swift test
cd ../MapFeature && xcodebuild -scheme MapFeature -destination 'platform=iOS Simulator,name=iPhone 16' build

# 3. App target
cd apps/ios
brew install xcodegen shellcheck
shellcheck ci_scripts/ci_post_clone.sh Packages/H3Kit/scripts/vendor-h3.sh scripts/vendor-h3.sh
xcodegen generate                                   # expect no "missing file" warnings
xcodebuild test -scheme NatureExplorer -destination 'platform=iOS Simulator,name=iPhone 16' | tail -5   # ** TEST SUCCEEDED **
open NatureExplorer.xcodeproj                       # Map tab renders OpenFreeMap liberty at Kaunas, zoom 12,
                                                    # attribution "© OpenStreetMap contributors, © OpenFreeMap" visible
git add apps/ios/Packages/MapFeature/Package.resolved  # (if generated) freeze the MapLibre 6.x version

# 4. Xcode Cloud (after the owner connects the repo): PR workflow = build + unit tests on scheme NatureExplorer
```

Things a macOS run may surface that could not be checked here:

- `MLNMapView` API names used in `MapLibreView.swift` (`init(frame:styleURL:)`, `setCenter(_:zoomLevel:animated:)`,
  `attributionButton`, `logoView`, `compassView`, `MLNMapViewDelegate` methods) against the resolved MapLibre 6.x.
- Strict-concurrency diagnostics in `MapLibreView.Coordinator` (non-isolated ObjC delegate; imported with
  `@preconcurrency import MapLibre`) and in `@MainActor @Observable AppContainer`.
- XcodeGen handling of the `Resources` folder reference (`type: folder`, `.gitkeep` excluded) and of the checked-in
  `Info.plist` (`INFOPLIST_FILE`, excluded from sources).
- `Package.swift` of `H3Kit`: on Apple platforms the `-lm` linker setting is Linux-only; the umbrella header is
  `Sources/CH3/include/CH3.h` (SwiftPM generates the module map from it). If Xcode complains about the private
  headers in `Sources/CH3/internal`, they are reached through `cSettings: [.headerSearchPath("internal")]`.

### Notes for Stream E (001)

- **Fixture assumptions**: the Swift `Codable` mirrors accept exactly the shapes in `data-model.md` §1 and were run
  against Stream A's committed files; `seed` is optional, unknown keys are ignored. `latlng-to-cell` pentagon cases
  expect `boundaryVertexCount` as produced by H3 (10 for a res-9 pentagon, not 5 as the data-model example says);
  the Swift test asserts `isPentagon == (vertexCount != 6)`.
- **Semantics chosen where plan.md leaves room** (both agree with Stream A's fixtures as committed): non-monotonic
  is checked against the last *accepted* sample's timestamp with `<=`; the walk `speed` median is the mean of the two
  middle values for an even count; in `pathToHexMeters` the length up to the first point found *outside* the cell is
  credited (metres are conserved exactly), then processing continues from that point; hysteresis is
  `challenger >= incumbent * (1 + 0.10)` in IEEE doubles (same expression as TypeScript should use — an exact
  1.10× boundary case is sensitive to this); an incumbent that falls below `MIN_STRENGTH_M` is treated as absent.
- `weekIdFor(_:)` is implemented (ISO week in UTC) with hand-checked unit tests although research.md R11 defers the
  shared `week-ids.json` fixture to feature 003 — wire the fixture then.
- `NATURE_FIXTURES_DIR` overrides the fixture directory for both packages; nothing temporary was committed under
  `apps/ios` (the scratch fixtures used before Stream A landed lived outside the repo).
- `.gitignore` (T043) should add `apps/ios/Packages/*/.build/` and `apps/ios/.build/`; the `.build` directories
  created by this verification were deleted before hand-off. `Package.resolved` for `MapFeature` will appear on the
  first macOS resolution and should be committed.
- Bundle id `com.natureexplorer.app` in `project.yml` is final (owner confirmed 2026-09-07); `DEVELOPMENT_TEAM` is set by the owner once the App ID exists.
