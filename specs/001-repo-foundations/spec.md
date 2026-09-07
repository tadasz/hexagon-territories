# Feature Specification: Repo Foundations

**Feature Branch**: `001-repo-foundations`

**Created**: 2026-09-07

**Status**: Draft

**Input**: User description: "Restructure the repository into the monorepo described in docs/architecture.md, install the shared territory rules with fixtures in TypeScript and Swift, stand up the API and iOS skeletons with CI, and record the foundational decisions so later features can be built by agents."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Shared territory rules with fixtures (Priority: P1)

An engineer or agent changes a territory rule (for example the weekly cap) and can prove the TypeScript rules and the Swift rules still agree, because both run the same committed fixtures.

**Why this priority**: Constitution Principle II makes rule parity the foundation of every later feature; without fixtures the walk-tracking and reckoning features cannot be verified.

**Independent Test**: Run `pnpm --filter territory-rules test` and `swift test` in `apps/ios/Packages/TerritoryRules`; both consume `packages/h3-fixtures/*.json` and pass. Change one expected value in a fixture and both suites fail.

**Acceptance Scenarios**:

1. **Given** the fixture `latlng-to-cell.json` with 200 coordinates, **When** both test suites run, **Then** every coordinate maps to the same res-9 cell and parents (res 8–5) in TypeScript and Swift.
2. **Given** the fixture `walk-paths.json` with six synthetic paths (straight line, edge-hugging, loop inside one cell, noisy zigzag, teleport, car speed), **When** `pathToHexMeters` runs, **Then** metres per cell match the expected values within 0.5 m and flagged paths are reported as flagged.
3. **Given** the fixture `reckoning-weeks.json` with three weeks of contributions, **When** the reckoning function runs week by week, **Then** strengths and owners after each week match the expected values, including decay, cap, minimum strength, hysteresis and unclaimed cases.
4. **Given** the prototype's zoom-to-resolution table, **When** `resolutionForZoom(z)` is called for z = 0…18, **Then** it returns the same resolution the prototype used.

---

### User Story 2 - API skeleton runs locally with the real database (Priority: P2)

A backend engineer or agent clones the repo, runs one command, and gets the API, Postgres with PostGIS and h3-pg, and local object storage running, with the schema from `docs/architecture.md` §6 migrated.

**Why this priority**: Every backend feature (002–008) starts from this skeleton and this schema.

**Independent Test**: `make dev` then `curl localhost:3000/health` returns `{"status":"ok","db":"ok"}`; `pnpm --filter api test` runs an integration test that migrates the schema into a Testcontainers Postgres and inserts a faction, a user and a hex state row.

**Acceptance Scenarios**:

1. **Given** Docker is available, **When** `make dev` runs, **Then** Postgres (PostGIS + h3-pg), MinIO and the API start and `/health` reports the database reachable.
2. **Given** the API is running, **When** `/openapi.json` is requested, **Then** a valid OpenAPI 3.1 document is returned containing the `/health` route and the shared error schema.
3. **Given** a fresh database, **When** migrations run, **Then** every table in `docs/architecture.md` §6 exists with the listed primary keys and the `location_samples` table is partitioned by month.
4. **Given** the `reckoning.weekly` job skeleton, **When** the API starts, **Then** pg-boss registers the job on the cron from `docs/territory-rules.md` and the job logs "no work" without error.

---

### User Story 3 - iOS shell builds and shows Kaunas (Priority: P2)

An iOS engineer or agent generates the Xcode project, builds the app, and sees a MapLibre map centred on Kaunas with the five tabs, with unit tests passing locally and on Xcode Cloud.

**Why this priority**: Every app feature (002–009) is added as a package into this shell.

**Independent Test**: `xcodegen generate && xcodebuild test -scheme NatureExplorer -destination 'platform=iOS Simulator,name=iPhone 16'` passes; launching the app shows the map.

**Acceptance Scenarios**:

1. **Given** the repo, **When** `xcodegen generate` runs, **Then** an Xcode project with the app target and the local packages `H3Kit`, `TerritoryRules`, `DesignSystem`, `MapFeature` opens without warnings about missing files.
2. **Given** the app launches in the simulator, **When** the Map tab is shown, **Then** a MapLibre map renders the OpenFreeMap `liberty` style centred on Kaunas at zoom 12.
3. **Given** `H3Kit`, **When** its tests run, **Then** `latLngToCell`, `cellToParent`, `cellToBoundary` and `polygonToCells` agree with the fixtures.
4. **Given** Xcode Cloud is connected, **When** a pull request is opened, **Then** the PR workflow builds the app and runs the unit tests using `ci_scripts/ci_post_clone.sh`.

---

### User Story 4 - Decisions and licences are recorded (Priority: P3)

A new contributor or agent can read why the stack looks the way it does, and which models and data sources are allowed, without asking anyone.

**Why this priority**: Prevents re-litigating decisions and guards Constitution Principle III.

**Independent Test**: `docs/adr/` contains ADRs 0001–0010; `ml/models/manifest.json` lists BirdNET+ V3, Geomodel and Perch v2 with licence and hash; `docs/licences.md` lists OpenFreeMap/OpenStreetMap, Pl@ntNet and BirdNET attribution text.

**Acceptance Scenarios**:

1. **Given** `ml/models/manifest.json`, **When** the model download script runs, **Then** the files are fetched into `apps/ios/Resources/Models` via git-lfs and their sha256 matches the manifest.
2. **Given** the licence inquiries to Cornell (BirdNET V2.4 commercial terms — optional until monetisation, draft only) and Pl@ntNet (Pro plan), **When** the feature is converged, **Then** the sent dates and contacts are recorded in `docs/licences.md`.

---

### Edge Cases

- What happens when h3-pg is not installable on the target Postgres? The schema and all queries must still work (bigint cells, precomputed parents, stored `geom`).
- How does `pathToHexMeters` treat a segment that crosses more than two cells (fast walker, sparse samples)? It must split at every boundary, not only the first.
- What happens when a fixture file is malformed? Both test suites fail with a clear message naming the file.
- What happens when Xcode Cloud has no git-lfs objects? `ci_post_clone.sh` must fetch them or fail the build explicitly.
- What if a contributor opens the repo without Docker? `pnpm --filter territory-rules test` must still run without the database.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The repository MUST have the monorepo layout in `docs/architecture.md` §3, with `prototype/index.html` kept unchanged as reference.
- **FR-002**: `packages/territory-rules` MUST export `resolutionForZoom`, `pathToHexMeters`, `applyWeeklyCap`, `reckonWeek`, `deriveParentOwner`, and the constants from `docs/territory-rules.md`, each as pure functions.
- **FR-003**: `packages/h3-fixtures` MUST contain the four fixtures named in User Story 1 with a documented JSON schema, generated by a checked-in script and reviewed by hand.
- **FR-004**: The Swift package `TerritoryRules` MUST implement the same functions and pass the same fixtures; `H3Kit` MUST wrap the vendored H3 C core for `latLngToCell`, `cellToParent`, `cellToChildren`, `cellToBoundary`, `polygonToCells`, `gridPathCells`.
- **FR-005**: `apps/api` MUST expose `/health` and `/openapi.json`, run Drizzle migrations for the §6 schema, and register the `reckoning.weekly` pg-boss job skeleton.
- **FR-006**: `infra/docker-compose.yml` MUST start Postgres 16 with PostGIS and h3-pg, MinIO, and the API; `make dev`, `make test`, `make down` MUST exist.
- **FR-007**: `apps/ios` MUST be generated by XcodeGen from `project.yml`, contain the app target with five tabs and the packages listed in §3, and render a MapLibre map of Kaunas.
- **FR-008**: CI MUST run: GitHub Actions `api.yml` (rules + API tests with the Postgres service container) on every pull request; Xcode Cloud PR workflow (build + unit tests) once the owner connects the repo.
- **FR-009**: `ml/models/manifest.json` MUST list every model with name, version, source URL, licence, sha256, sample rate and window; a script MUST download and verify them.
- **FR-010**: `docs/adr/0001–0010` and `docs/licences.md` MUST exist and be linked from `README.md`.
- **FR-011**: The root `.gitignore` MUST exclude generated Xcode projects, model binaries outside git-lfs, and local Spec Kit state.

### Key Entities

- **Fixture**: a JSON document with `name`, `description`, `inputs`, `expected` and a `generator` reference; consumed by both rule implementations.
- **Territory rule constants**: the values in `docs/territory-rules.md` "Constants summary".
- **Model manifest entry**: name, version, source, licence, sha256, sample rate, window length, label file.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new contributor reaches a green `make test` and a running API within 30 minutes of cloning on a machine with Docker and Node installed.
- **SC-002**: Both rules test suites pass on the same fixtures; a deliberate one-value change in a fixture fails both.
- **SC-003**: The iOS app builds and its unit tests pass on Xcode Cloud in under 20 minutes per run.
- **SC-004**: `/speckit-converge` reports Converged for this feature with no open tasks.

## Assumptions

- The owner connects the GitHub repository to Xcode Cloud in App Store Connect; until then the iOS workflow is verified locally with `xcodebuild`.
- Model weights are stored with git-lfs; the repository has LFS enabled on GitHub.
- No Apple Developer Program capabilities beyond the basic app identifier are needed in this feature (Sign in with Apple arrives in 002).
- The Postgres image is built from `postgis/postgis:16-3.4` with h3-pg installed from PGXN.
- Faction names are Owls, Foxes and Deer, seeded in the `factions` table (`data-model.md` §4.2); renaming is a data change.
