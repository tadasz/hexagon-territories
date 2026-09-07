# Nature Explorer

A native iOS game for nature explorers: **conquer H3 hexagons by walking, capture birds by sound, capture plants by photo.** Players belong to factions; the metres they walk inside each hexagon are tallied at the end of every walk, and once a week a reckoning decays old strength and decides which faction owns each hexagon.

This repository started as a Leaflet + h3-js web prototype (now in `prototype/index.html`). It is being rebuilt as a SwiftUI app with a TypeScript API on Postgres.

## Documents

| Document | What it is |
|---|---|
| [`docs/mvp.md`](docs/mvp.md) | What the MVP is and how we measure it |
| [`docs/architecture.md`](docs/architecture.md) | Stack, monorepo layout, iOS/app/backend design, data model, recognition pipelines |
| [`docs/territory-rules.md`](docs/territory-rules.md) | Tunable game rules: metres per hex, caps, weekly decay, ownership, parents |
| [`docs/roadmap.md`](docs/roadmap.md) | Phases, feature backlog (Spec Kit feature numbers), effort and exit criteria |
| [`docs/adr/README.md`](docs/adr/README.md) | Architecture decision records (ADR 0001–0010) |
| [`docs/licences.md`](docs/licences.md) | Licence and attribution register for models, data, tiles and tooling |
| [`ml/models/manifest.json`](ml/models/manifest.json) | Pinned ML models: version, source, licence, sha256 (see [`ml/models/README.md`](ml/models/README.md)) |
| [`.specify/memory/constitution.md`](.specify/memory/constitution.md) | Binding principles every feature must satisfy |
| [`specs/001-repo-foundations/quickstart.md`](specs/001-repo-foundations/quickstart.md) | How to verify the repo foundations end to end |
| [`specs/002-auth-and-factions/quickstart.md`](specs/002-auth-and-factions/quickstart.md) | How to verify Sign in with Apple, sessions, factions, profile, deletion and export |
| [`specs/003-walk-tracking/quickstart.md`](specs/003-walk-tracking/quickstart.md) | How to verify walk recording, sample ingest, `finishWalk` scoring, offline sync and GPX replay |
| `specs/NNN-name/` | Spec Kit feature directories (spec → plan → tasks) |

## Layout

```
apps/ios        SwiftUI app (XcodeGen project.yml + local Swift packages H3Kit, TerritoryRules, DesignSystem, MapFeature,
                Core, APIClient (swift-openapi-generator over the committed snapshot), AuthFeature, FactionsFeature, ProfileFeature,
                Location (background walk recording), Persistence (GRDB outbox + SyncCoordinator), WalkFeature (Walk tab, history))
apps/api        @nature/api — Fastify 5 + TypeBox (OpenAPI 3.1) + Drizzle ORM + pg-boss; Sign in with Apple, JWT sessions, factions, profile,
                walk sessions, sample ingest and the single finishWalk scoring path
packages/       @nature/territory-rules (pure TS rules), @nature/h3-fixtures (shared JSON fixtures + schema),
                @nature/api-schema (committed OpenAPI snapshot the iOS client is generated from),
                @nature/walk-sim (GPX/GeoJSON → timed sample batches; replay CLI and the oracle of the API walk tests)
ml/             model manifest, download/verify script, label files, licence inquiry drafts, eval-set layout
infra/          docker-compose (Postgres 16 + PostGIS + h3-pg, MinIO, API), Postgres image
docs/           architecture, rules, roadmap, ADRs, licences
specs/          Spec Kit features
prototype/      original web prototype (reference only, not built)
```

Deferred to later features (see `specs/001-repo-foundations/plan.md` "Structure Decision"): `apps/ml-worker` (006), `infra/caddy` and `docs/privacy/` (009).

## Getting started

Prerequisites: Node 22 and pnpm 10 (`corepack enable`, or `mise install` from `.tool-versions`), Docker Compose v2 for the database, Python 3.11 for the model tooling. Xcode 16 + XcodeGen for the iOS app (macOS); a Swift 6 toolchain is enough for the two Foundation-only Swift packages on Linux.

```bash
pnpm install --frozen-lockfile     # workspace install; pnpm-lock.yaml is committed
pnpm lint && pnpm typecheck        # ESLint (type-aware) + Prettier, tsc per workspace
pnpm test                          # unit tests in every workspace; DB integration suites are skipped (SKIP_DB_TESTS=1)
```

### API and database (Docker)

```bash
make dev            # builds nature-postgres:16-3.4-h3, starts postgres + minio, migrates, runs the API on :3000
curl -s localhost:3000/health       # {"status":"ok","db":"ok","version":"0.1.0"}
curl -s localhost:3000/openapi.json | jq '.openapi'   # "3.1.0"
make test           # starts postgres and runs every test suite including the DB integration tests (pnpm test:db)
make down           # stops the stack and deletes its volumes
```

Without Docker, point the integration tests at any Postgres 16 + PostGIS with a superuser:
`DATABASE_URL=postgres://nature:nature@localhost:5432/nature pnpm test:db` (each suite creates and drops a throwaway `nature_test_*` database). `make help` lists the other targets (`db-migrate`, `db-reset`, `logs`, `lint`).

The API needs `JWT_SECRET` (≥ 32 chars), `APPLE_CLIENT_IDS` (bundle ids, comma-separated) and `APPLE_JWKS_URL`; `S3_*` point at MinIO (`make dev`) or Hetzner Object Storage. The walk limits are tunable through `WALK_AUTOFINISH_AFTER_H` (12), `WALK_SAMPLE_RETENTION_DAYS` (30), `WALK_XP_DAILY_CAP` (300), `WALK_INGEST_BATCHES_PER_15MIN` (30) and `WALK_SAMPLES_PER_DAY` (8 640) — the defaults live in `apps/api/src/modules/walks/limits.ts` and are the numbers `docs/architecture.md` §5 quotes. `apps/api/.env.example` lists every variable with its default; the test helpers set their own values, so `pnpm test` / `pnpm test:db` need none of them.

### Auth, accounts and the OpenAPI snapshot

```bash
pnpm --filter @nature/api dev:apple-stub --port 4567 --sub stub-user-1 --email stub@example.com   # local JWKS + a Sign in with Apple identity token (no Apple account needed); then APPLE_JWKS_URL=http://localhost:4567/keys
pnpm --filter @nature/api job:purge --user <user id>        # erase an account whose 30-day grace has passed (idempotent)
pnpm --filter @nature/api job:export --user <user id>       # build a data-export bundle into object storage (needs MinIO)
pnpm --filter @nature/api openapi:print | jq '.paths | keys'   # the generated OpenAPI 3.1 document, no database needed
pnpm --filter @nature/api-schema snapshot && apps/ios/scripts/sync-openapi.sh   # after any route change: refresh packages/api-schema/openapi.json and the iOS copy
pnpm --filter @nature/api-schema test                       # fails with "stale" when the snapshot or the iOS copy is behind the code
```

pnpm 10 forwards everything after the script name to the script unchanged, so write the flags directly
(`… dev:apple-stub --port 4567`) and do not insert `--` before them: pnpm passes the literal `--` on, and while the
`job:*` runner (`src/jobs/run.ts`) drops it, `node:util` `parseArgs` in `scripts/apple-stub.ts` rejects it.

### Walks and GPX replay

```bash
pnpm --silent --filter @nature/walk-sim walk-sim dry-run packages/walk-sim/samples/azuolynas-loop.gpx --json   # expected per-hex metres, XP and flags without an API (the test oracle)
pnpm --silent --filter @nature/walk-sim walk-sim replay packages/walk-sim/samples/azuolynas-loop.gpx \
  --base-url http://localhost:3000 --token "$TOKEN" --rate 60     # POST /v1/walks → batched samples → finish, as the app would; prints the server summary
pnpm --filter @nature/walk-sim samples:generate             # regenerate the three synthetic GPX tracks under packages/walk-sim/samples (byte-identical)
pnpm --filter @nature/api job:autofinish                    # finish every walk active for more than WALK_AUTOFINISH_AFTER_H once (walk.autofinish; hourly in production)
pnpm --filter @nature/api job:purge-samples                 # drop location_samples partitions older than WALK_SAMPLE_RETENTION_DAYS once (samples.purge; daily in production)
```

`--silent` keeps pnpm's own banner out of the JSON. `packages/walk-sim/README.md` documents the distortion flags (`--teleport`, `--spoof-no-steps`, `--jitter`, …), the library API used by `apps/api/test/integration/walks-finish.test.ts` and the GPX `<extensions>` that pin a scenario. Scoring happens only in `POST /v1/walks/{id}/finish` (`docs/territory-rules.md` "Scoring at walk finish"); a replay never changes who owns a hexagon.

### iOS

```bash
cd apps/ios/Packages/H3Kit && swift test           # Linux or macOS: H3 wrapper vs packages/h3-fixtures
cd ../TerritoryRules && swift test                 # Swift rules vs the same four fixtures as the TypeScript package
cd ../Core && swift test                           # AuthSession state machine, validators, faction-pick presentation, walk models (Foundation only)
cd ../Location && swift test                       # PathRecorder / HexMetersEstimator fixture parity with the rules package, WalkTracker state machine
cd ../Persistence && swift test                    # GRDB schema, outbox FIFO, back-off, SyncCoordinator exactly-once (needs libsqlite3-dev on Linux: GRDB links the system SQLite)
cd ../WalkFeature && swift test                    # walk and history view models over the real in-memory GRDB graph
for p in APIClient AuthFeature FactionsFeature ProfileFeature DesignSystem; do (cd ../$p && swift test); done   # also Linux: SwiftUI code sits behind canImport
cd apps/ios && xcodegen generate && xcodebuild test -scheme NatureExplorer \
  -destination 'platform=iOS Simulator,name=iPhone 16'   # macOS only
```

`apps/ios/README.md` covers Xcode Cloud setup and configuration; `apps/ios/VERIFY.md` lists exactly what has been verified on Linux and what still needs a macOS run.

### ML models

```bash
python3 -m unittest discover -s ml/tests -v                              # manifest schema, licence policy, download script
python3 ml/scripts/download_models.py --only birdnet-geomodel            # downloads into ml/models/cache (gitignored) and verifies sha256
python3 ml/scripts/download_models.py --skip-download                    # re-verifies cached files against the manifest
python3 ml/scripts/download_models.py --dest apps/ios/Resources/Models   # copies verified weights for the git-lfs commit
```

Model weights are tracked with git-lfs (`.gitattributes`); run `git lfs install` once per clone before committing anything under `apps/ios/Resources/Models`.

## Development process (Spec Kit)

Every feature is driven through the Spec Kit loop with Claude Code:

```
/speckit-specify   → specs/NNN-name/spec.md
/speckit-clarify   → resolve open questions
/speckit-plan      → plan.md, research.md, data-model.md, contracts/, quickstart.md
/speckit-tasks     → tasks.md
/speckit-analyze   → consistency check (specs/NNN-name/analysis.md)
/speckit-implement → code
/speckit-converge  → repeat until "Converged"
```

Feature numbers and short names are fixed in `docs/roadmap.md`; create a new feature with

```
.specify/scripts/bash/create-new-feature.sh --number 2 --short-name auth-and-factions "Sign in with Apple, faction pick, profile"
```

Point Spec Kit at a feature without switching branches with `export SPECIFY_FEATURE=001-repo-foundations SPECIFY_FEATURE_DIRECTORY=specs/001-repo-foundations`. Agent guidance lives in `CLAUDE.md`.

## Continuous integration

`.github/workflows/api.yml` runs on every pull request: job `rules` (`pnpm lint`, typecheck + tests of `packages/*`, including the `@nature/api-schema` snapshot check), job `api` (builds the Postgres image from `infra/docker/postgres`, smoke-tests h3-pg, then builds, lints and runs the API tests against it) and job `swift` (`swift test` in every Linux-buildable Swift package — including `Location`, `Persistence` and `WalkFeature`, after installing `libsqlite3-dev` for GRDB — inside the official `swift:6.2.1` container). The app target and the SwiftUI views are built and tested by Xcode Cloud once the owner connects the repository (`apps/ios/ci_scripts/ci_post_clone.sh`).
