# Implementation Plan: Repo Foundations

**Branch**: `001-repo-foundations` | **Date**: 2026-09-07 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-repo-foundations/spec.md`

**Note**: This plan references `docs/architecture.md` (stack, monorepo layout, data model) and `docs/territory-rules.md` (game rules, constants) instead of restating them. Anything here that differs from those documents is listed under **Deviations** and justified.

## Summary

Turn the planning repository into the monorepo of `docs/architecture.md` §3 and stand up four foundations that every later feature builds on: (1) the shared territory rules as a TypeScript package plus committed JSON fixtures, mirrored by a Swift package that runs the same fixtures; (2) a Fastify API skeleton that migrates the full §6 Postgres schema, exposes `/health` and `/openapi.json`, and registers the `reckoning.weekly` job; (3) an XcodeGen iOS shell with `H3Kit`, `TerritoryRules`, `DesignSystem` and `MapFeature` packages that renders a MapLibre map of Kaunas; (4) the model manifest, download/verify script, git-lfs tracking and licence records. The work is split into four parallel streams on disjoint directories (A rules, B api, C ios, D ml) and one integration stream (E) that wires the root and converges. See `research.md` for the decisions and `tasks.md` for the streams.

## Technical Context

**Language/Version**: TypeScript 5.8+ on Node 22 (API, rules, fixtures); Swift 6 / iOS 17+ (app, `H3Kit`, `TerritoryRules`); C (vendored Uber H3 core inside `H3Kit`); Python 3.11 (model download/verify script, stdlib only); Bash (CI scripts). Versions pinned in `.tool-versions` (`nodejs 22.22.2`, `python 3.11.15`).

**Primary Dependencies**: pnpm 10 workspaces + turborepo 2; `h3-js` 4.x; Vitest 3; Fastify 5, `@fastify/swagger` (OpenAPI 3.1), `@fastify/type-provider-typebox` + `@sinclair/typebox` 0.34; Drizzle ORM 0.44 + Drizzle Kit (node-postgres driver `pg` 8); pg-boss 10; `@testcontainers/postgresql`; XcodeGen 2.4x; MapLibre Native iOS 6.x (SPM `maplibre-gl-native-distribution`); XCTest. Exact versions are chosen by the implementing stream at the latest patch of the listed major and frozen in `pnpm-lock.yaml` / `Package.resolved`.

**Storage**: Postgres 16 + PostGIS 3.4 (image built from `postgis/postgis:16-3.4` with h3-pg from PGXN, `infra/docker/postgres/Dockerfile`); MinIO locally (S3 API); no application data written in this feature beyond the migrated schema and seed factions.

**Testing**: Vitest (rules, fixtures, API unit); Vitest + Testcontainers or `DATABASE_URL` (API integration, skippable with `SKIP_DB_TESTS=1`); XCTest via `swift test` on Linux and macOS for `H3Kit` and `TerritoryRules`; `xcodebuild test` on Xcode Cloud / macOS for the app target; `python -m unittest` for `ml/scripts`.

**Target Platform**: Linux server (API, Docker Compose); iOS 17+ (app); developer machines are macOS (full) or Linux (everything except the app target).

**Project Type**: Monorepo: mobile app + API + shared libraries.

**Performance Goals**: Not a runtime feature. CI budget: GitHub Actions `api.yml` < 10 min per PR; Xcode Cloud PR workflow < 20 min (SC-003). Fixture suites run in < 10 s each.

**Constraints**: iOS app target compiles only on macOS/Xcode Cloud; `H3Kit` and `TerritoryRules` MUST also build and pass `swift test` on a Linux Swift 6 toolchain (no UIKit, SwiftUI or MapLibre imports in those two packages). Docker may be unavailable in agent containers: API unit tests always run; DB integration tests skip cleanly with `SKIP_DB_TESTS=1`. Node 22 and pnpm are available everywhere. git-lfs and Docker are not available in the planning container.

**Scale/Scope**: ~4 TypeScript workspaces, 4 Swift packages + 1 app target, 1 Dockerfile + compose file, 1 GitHub Actions workflow, 4 fixture files (~200 coordinates, 6 paths, 3 weeks × ~8 cells, 19 zoom levels), full §6 schema (~25 tables, 3 enums).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this feature complies |
|---|---|---|
| I. Server-authoritative game state | PASS | No scoring code path exists yet; the rules package is pure and side-effect free. `hex_state.owner_faction_id` is written by no code in this feature (the `reckoning.weekly` skeleton logs "no work"). |
| II. One place for each rule | PASS | Constants live in `packages/territory-rules/src/config.ts` and mirror `docs/territory-rules.md` "Constants summary" one-to-one; `TerritoryRules` (Swift) mirrors them; both suites read `packages/h3-fixtures/fixtures/*.json`. Fixture generator is checked in; fixtures are hand-reviewed. |
| III. Licence before ship | PASS | Every model in `ml/models/manifest.json` already has a licence; this feature adds sha256 + download script and adds rows to `docs/licences.md` for the development basemap (OpenFreeMap) and H3 vendored source. No non-commercial weights are referenced by iOS code (no audio package in 001). |
| IV. Privacy by default | PASS | Schema includes 30-day partitioned `location_samples`; no analytics SDK is added in 001. |
| V. Test at the layer you touch | PASS | Rules: fixture-driven unit tests (TS + Swift). API: integration test against the real Postgres image (Testcontainers / `DATABASE_URL`) plus unit tests. iOS: XCTest per package. `quickstart.md` is executable. CI red blocks merge. |
| VI. Small, mergeable steps | PASS | Tasks are grouped into streams on disjoint paths; each task is one PR-sized unit with an acceptance check. |
| VII. Battery and offline are features | N/A | No tracking or capture code in 001. The iOS shell adds no background modes yet. |
| Workflow: plan references architecture docs | PASS | This file links `docs/architecture.md` §3, §5, §6 and `docs/territory-rules.md` instead of copying them; deviations listed below. |
| Workflow: contracts as OpenAPI fragments in `contracts/` | PASS (partial) | `contracts/openapi.yaml` covers `/health`, `/openapi.json` and the shared error schema. `packages/api-schema` (merge target) is deferred to feature 002 when the first generated client is needed — see Deviations. |
| Workflow: tunable constants only via `territory-rules.md` + `config.ts` | PASS | `config.ts` is created from the doc; a test asserts the constants table in the doc matches `config.ts`. |

**Post-design re-check (after Phase 1)**: No new violations. The one structural addition beyond `docs/architecture.md` §3 is `packages/h3-fixtures/scripts/` (fixture generator) and `ml/scripts/`, both explicitly required by FR-003 / FR-009.

## Project Structure

### Documentation (this feature)

```text
specs/001-repo-foundations/
├── plan.md              # This file
├── research.md          # Phase 0: decisions with rationale (cites docs/adr)
├── data-model.md        # Phase 1: fixture schemas, manifest schema, §6 Postgres schema as migrated
├── quickstart.md        # Phase 1: how to verify each stream and the whole feature
├── contracts/
│   └── openapi.yaml     # Phase 1: /health, /openapi.json, Error schema
└── tasks.md             # Phase 2: streams A–E
```

### Source Code (repository root)

The target layout is `docs/architecture.md` §3. The subset created by this feature, with the stream that owns each path:

```text
package.json  pnpm-workspace.yaml  turbo.json  tsconfig.base.json     # root scaffolding (created by the planner)
.tool-versions  .editorconfig  .prettierrc  .prettierignore  eslint.config.mjs
Makefile                                   # Stream B
.gitattributes                             # Stream D (git-lfs for *.onnx, *.tflite)
.gitignore  README.md  pnpm-lock.yaml      # Stream E (root wiring)
.github/workflows/api.yml                  # Stream B

packages/
  territory-rules/                         # Stream A — @nature/territory-rules
    package.json  tsconfig.json  tsconfig.build.json  vitest.config.ts
    src/{index,config,zoom,samples,simplify,path-to-hex,cap,reckoning,parents,types}.ts
    test/*.test.ts
  h3-fixtures/                             # Stream A — @nature/h3-fixtures
    package.json  tsconfig.json  README.md
    fixtures/{latlng-to-cell,walk-paths,reckoning-weeks,zoom-resolution}.json
    schema/*.schema.json                   # generated from src/schema.ts
    scripts/generate.ts                    # deterministic (seeded) generator
    src/{index,schema,load}.ts

apps/
  api/                                     # Stream B — @nature/api
    package.json  tsconfig.json  vitest.config.ts  drizzle.config.ts  .env.example
    src/{app,server,config}.ts
    src/plugins/{db,openapi,error-handler,jobs}.ts
    src/modules/health/{routes,schemas}.ts
    src/jobs/reckoning-weekly.ts
    src/db/{client,schema/*.ts,migrate.ts}
    drizzle/0000_*.sql  drizzle/0001_partitions.sql  drizzle/meta/
    test/{unit,integration}/**/*.test.ts  test/helpers/db.ts
  ios/                                     # Stream C
    project.yml
    NatureExplorer/{App.swift,RootView.swift,AppContainer.swift,Info.plist}
    Packages/H3Kit/{Package.swift,Sources/CH3/**,Sources/H3Kit/*.swift,Tests/H3KitTests/*.swift,scripts/vendor-h3.sh}
    Packages/TerritoryRules/{Package.swift,Sources/TerritoryRules/*.swift,Tests/TerritoryRulesTests/*.swift}
    Packages/DesignSystem/{Package.swift,Sources/DesignSystem/*.swift}
    Packages/MapFeature/{Package.swift,Sources/MapFeature/*.swift,Resources/styles/}
    Resources/Models/.gitkeep
    ci_scripts/ci_post_clone.sh
    Tests/NatureExplorerTests/*.swift

infra/                                     # Stream B
  docker-compose.yml
  docker/postgres/Dockerfile
  minio/.gitkeep

ml/                                        # Stream D
  models/manifest.json (sha256 filled)  models/labels/  models/cache/ (gitignored)
  scripts/download_models.py  tests/test_manifest.py
  licensing/{birdnet-v24-inquiry.md,plantnet-pro-inquiry.md}
  eval/README.md
docs/licences.md                           # Stream D (rows + inquiry log updates)
```

**Structure Decision**: Monorepo per `docs/architecture.md` §3. Not created in this feature (deferred, with the feature that first needs them): `packages/api-schema` (002), `packages/walk-sim` (003/004), `apps/ml-worker` (006), `infra/caddy` (009), `.github/workflows/ml-eval.yml` (006), `docs/privacy/` (009), iOS packages other than the four above.

## Package and Target Names (use everywhere)

| Thing | Name |
|---|---|
| Root workspace | `nature-explorer` (private) |
| TS rules package | `@nature/territory-rules` (`packages/territory-rules`) |
| TS fixtures package | `@nature/h3-fixtures` (`packages/h3-fixtures`) |
| API workspace | `@nature/api` (`apps/api`) |
| Swift packages | `H3Kit` (products `H3Kit`, C target `CH3`), `TerritoryRules`, `DesignSystem`, `MapFeature` |
| Xcode app target / scheme | `NatureExplorer` (bundle id `app.dogo.natureexplorer`, placeholder until the owner sets the App ID) |
| Postgres image tag | `nature-postgres:16-3.4-h3` (built from `infra/docker/postgres`) |
| Compose services | `postgres`, `minio`, `api` |
| pg-boss job | `reckoning.weekly` |
| Docker network / DB name | `nature`, database `nature`, user `nature`, password `nature` (local only) |

Turbo pipeline (root `turbo.json`): `build` → `typecheck` / `test` depend on `^build`; `lint` is independent. Every TS workspace exposes the scripts `build`, `test`, `lint`, `typecheck`, `clean` (empty scripts are fine) so `pnpm test` at the root runs everything.

## Shared Rule Semantics (both implementations must match)

Defined once here so Stream A (TypeScript) and Stream C (Swift) implement the same behaviour without talking to each other. Detailed types are in `data-model.md`.

1. **Cell identifiers** in fixtures and TS are H3 index strings (15 lowercase hex chars); Swift converts with `stringToH3`/`h3ToString`; Postgres stores `bigint`.
2. **Coordinates** are `{lat, lon}` in WGS84 decimal degrees. Distances are haversine on a sphere of radius 6 371 008.8 m.
3. **`resolutionForZoom(z)`**: the prototype's table (`prototype/index.html`, `zoomToResolution`): z ≥ 16 → 9, 14–15 → 8, 12–13 → 7, 10–11 → 6, 8–9 → 5, 6–7 → 4, 4–5 → 3, 2–3 → 2, 0–1 → 1. Non-integer zooms are floored; z < 0 → 1; z > 18 → 9. Fixture `zoom-resolution.json`.
4. **Sample acceptance** (`acceptSamples`): apply the table in `docs/territory-rules.md` "Walk acceptance" in order: non-monotonic timestamp → `non_monotonic`; `hAcc > 50` → `accuracy`; `speed` present and `> 5` → `speed`. Rejected samples carry `{seq, reason}`.
5. **Walk flags** (`walkFlags`): `teleport` if implied speed between consecutive accepted samples > 8 m/s; `speed` if the median implied speed > 3.5 m/s; `distance` if total length > 30 000 m or duration > 6 h; `no_steps` if `steps / distanceM < 0.5` and `distanceM > 500` (only when pedometer steps are provided). Flags are reported; samples are not removed.
6. **Simplification** (`simplifyPath`): Douglas–Peucker with 5 m perpendicular tolerance measured in a local equirectangular projection centred on the path; endpoints always kept.
7. **`pathToHexMeters(points, {resolution: 9})`**: for each consecutive pair (a, b): if `cell(a) == cell(b)` credit the full haversine length to that cell (H3 cells are convex, so a straight segment cannot leave and re-enter); otherwise bisect the segment (interpolating linearly in lat/lon) until the crossing point is located within 0.05 m, credit the part before the crossing to `cell(a)` and recurse on the remainder — this splits at every boundary, not only the first. Output is sorted by cell string ascending; metres are summed per cell; cells with < 0.01 m are dropped. Fixture tolerance is ±0.5 m.
8. **`applyWeeklyCap(contributions)`**: sum metres per `(cell, factionId, userId)`; `cappedMeters = min(sum, 2000)`. Bonuses are never capped by this function.
9. **`reckonWeek(cellInput)`**: exactly `docs/territory-rules.md` "Weekly reckoning": `strength' = strength × 0.5 + Σ cappedMeters + Σ bonusMeters` per faction (factions absent from both are dropped when strength' < 0.001); owner decided by the ownership table with `MIN_STRENGTH_M = 500` and `HYSTERESIS = 0.10`; exact tie at the top keeps the incumbent, else unclaimed. Returns new strengths (sorted by factionId), `owner`, `flipped`, and `event {from, to}` when flipped. Pure; idempotency is the job's concern (feature 004).
10. **`deriveParentOwner(childOwners)`**: ignore `null`s; `claimed = count of non-null`; if `claimed < 2` → null; leader = faction with the most children; if leader count is tied → null; if `leaderCount / claimed > 0.40` → leader else null.
11. **Malformed fixture** → the loader throws / `XCTFail`s with a message containing the file name and the JSON path of the first invalid field.

## Deviations from `docs/architecture.md` / ADRs

| Deviation | Justification |
|---|---|
| iOS shell has **five** tabs (Map, Walk, Capture, Collection, Profile), not the six in §4 | `spec.md` FR-007 says five; Factions arrives with feature 002 (auth-and-factions), which owns faction UI. |
| MapFeature's default style URL is the OpenFreeMap "liberty" style (OSM data, no key) instead of the Protomaps PMTiles extract from our bucket | The object-storage bucket and the Lithuania PMTiles extract are provisioned in feature 005 (hex-map). The style URL is a single configuration value (`MapConfig.styleURL`), so switching is a one-line change. OSM attribution is already listed in `docs/licences.md`; Stream D adds the OpenFreeMap row. |
| GitHub Actions starts the Postgres image with `docker build` + `docker run` in the job instead of a `services:` container | The h3-pg image is built from `infra/docker/postgres` and is not published to a registry yet; `services:` can only pull images. Behaviour is the same (tests hit `DATABASE_URL`). Publishing to GHCR is a follow-up once the repository is public or a package token exists. |
| API tests can run without Docker (`SKIP_DB_TESTS=1`) | Agent containers and some laptops have no Docker; unit tests must stay useful. CI always runs the DB tests. |
| `packages/api-schema` is not created | Nothing consumes a generated client yet; the API serves `/openapi.json` at runtime and `contracts/openapi.yaml` is the reviewed fragment. Feature 002 creates the package when `swift-openapi-generator` is wired. |
| `ml/scripts/download_models.py` writes to `ml/models/cache/` (gitignored) by default, not directly to `apps/ios/Resources/Models` | Keeps stream D off stream C's paths; `--dest apps/ios/Resources/Models` copies the verified files for the LFS commit, which is done in Stream E by whoever has git-lfs. |
| Sample rejection reason `non_monotonic` is checked before accuracy | The rules table does not define an order; fixing one avoids TS/Swift divergence on samples that fail two checks. |

## Complexity Tracking

No constitution violations to justify. The deviations above are scope/sequencing choices, not added complexity.

## Environment notes for implementation agents

- This planning container has **no Xcode, no Swift toolchain, no Docker, no git-lfs**. The orchestrator will tell each stream what its container has. Rules of thumb: Stream A and B need only Node 22 + pnpm (B's DB tests skip without Docker); Stream C needs a Swift 6 toolchain to run `swift test` for `H3Kit` and `TerritoryRules`, and the app target is verified on Xcode Cloud/macOS only; Stream D needs Python 3.11 and network access to download models (if downloads fail, sha256 stays `null` and the task records the blocker).
- `pnpm-lock.yaml` and `node_modules/` are scratch for Streams A and B: install freely, but do not hand the lockfile over; Stream E generates the committed lockfile with `pnpm install` at the root.
- Set `export SPECIFY_FEATURE=001-repo-foundations SPECIFY_FEATURE_DIRECTORY=specs/001-repo-foundations` before any `.specify/scripts/bash/*.sh` script.
