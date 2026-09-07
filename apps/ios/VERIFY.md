# Verification log — Stream C (`apps/ios`), feature 001-repo-foundations

Written by the implementing agent on 2026-09-07 in a Linux (Ubuntu 24.04) container **without Xcode, XcodeGen or an
iOS SDK**. A Swift 6.2.1 Linux toolchain (`swift-6.2.1-RELEASE-ubuntu24.04`) was downloaded into the container so the
two Foundation-only packages could be built and tested for real; everything that needs UIKit/SwiftUI/MapLibre could
only be syntax-parsed and reviewed. This file lists exactly what was verified, how, and what must still be run on
macOS / Xcode Cloud (Stream E, T045).

## Verified here (Linux, Swift 6.2.1, `-Xswiftc -warnings-as-errors`)

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

## Not verified here — run on macOS (Xcode 16 / Swift 6) or Xcode Cloud

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
open NatureExplorer.xcodeproj                       # five tabs; Map tab renders OpenFreeMap liberty at Kaunas, zoom 12,
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

## Notes for Stream E

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
