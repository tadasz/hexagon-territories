# Verification log — `apps/ios`

Two entries: feature **002-auth-and-factions** (Stream B, this section) and feature **001-repo-foundations** (Stream C,
kept below for the record). Both were written in a Linux (Ubuntu 24.04) container **without Xcode, XcodeGen or an iOS
SDK**; the Swift 6.2.1 Linux toolchain (`swift-6.2.1-RELEASE-ubuntu24.04`, downloaded from swift.org into the
session's scratch directory and put on `PATH` with `export PATH=<toolchain>/usr/bin:$PATH`) built and tested everything
that does not import SwiftUI, UIKit, AuthenticationServices, Security or MapLibre.

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
./scripts/sync-openapi.sh                          # after Stream A/C: replaces the temporary openapi.json (see below)
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

### Temporary `openapi.json` (T020) — action for Stream C

`Packages/APIClient/Sources/APIClient/openapi.json` was generated from
`specs/002-auth-and-factions/contracts/openapi.yaml` (`scripts/sync-openapi.sh --from-contract`) because
`packages/api-schema/openapi.json` (Stream A, T014) did not exist yet. Its `info["x-source"]` says so. Stream C (T028)
replaces it with `apps/ios/scripts/sync-openapi.sh` after `pnpm --filter @nature/api-schema snapshot`; the equality test
in `@nature/api-schema` then covers it. The generated Swift names the adapters use (`Operations.SignInWithApple.Output`
`.ok/.undocumented`, `Components.Schemas.Me.RolePayload`, `ExportStatus.StatusPayload`, `_Error`) come from the
contract's `operationId`s and schema names, which the snapshot must keep (Stream A's TypeBox `$id`s match
`data-model.md` §2).

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
