# Quickstart: Repo Foundations

How a reviewer or agent verifies feature `001-repo-foundations`. Each section maps to one task stream in `tasks.md`; the last section is the whole-feature check. Commands are run from the repository root unless stated.

## Prerequisites

| Tool | Needed by | Notes |
|---|---|---|
| Node 22, pnpm 10 (`corepack enable` or `.tool-versions` via mise) | A, B, E | always required |
| Docker (Compose v2) | B (DB tests), E | optional: set `SKIP_DB_TESTS=1` without it |
| Swift 6 toolchain (Linux or macOS) | C (packages) | `swift --version` ≥ 6.0 |
| Xcode 16 + XcodeGen (`brew install xcodegen`) | C (app target) | macOS only; otherwise verified on Xcode Cloud |
| Python 3.11 | D | stdlib only |
| git-lfs | E (model commit) | `git lfs install` |

Spec Kit scripts need `export SPECIFY_FEATURE=001-repo-foundations SPECIFY_FEATURE_DIRECTORY=specs/001-repo-foundations`.

## 0. Root workspace (already scaffolded)

```bash
pnpm install                 # creates pnpm-lock.yaml (committed by Stream E only)
pnpm turbo run build         # no-op until workspaces exist
```

Expected: no errors; `pnpm-workspace.yaml` lists `apps/*` and `packages/*`.

## A. Territory rules and fixtures (User Story 1)

```bash
pnpm install
pnpm --filter @nature/h3-fixtures generate      # regenerates fixtures deterministically
git diff --stat packages/h3-fixtures/fixtures   # expected: no changes (byte-identical)
pnpm --filter @nature/h3-fixtures test           # schema validation of all four fixtures
pnpm --filter @nature/territory-rules test       # fixture-driven suites
```

Expected outcomes:

- `latlng-to-cell.json`: 200 coordinates, every one maps to the expected res-9 cell and res 8–5 parents.
- `walk-paths.json`: six paths; metres per cell within ±0.5 m; `teleport` and `car-speed` paths report their flags.
- `reckoning-weeks.json`: three weeks; strengths (±0.01) and owners match after each week.
- `zoom-resolution.json`: z = 0…18 map to the prototype's table.
- Constants test: every key in `docs/territory-rules.md` "Constants summary" equals `RULES.<key>` in `config.ts`.

Mutation check (SC-002): edit one `expected` value in `fixtures/walk-paths.json`, run the two test commands again — both fail naming the fixture and case; revert with `git checkout packages/h3-fixtures/fixtures`.

Malformed fixture check: `echo '{' > /tmp/bad.json` and point the loader at it (`FIXTURES_DIR=/tmp pnpm --filter @nature/territory-rules test`) — failure message names the file.

## B. API skeleton and infra (User Story 2)

With Docker:

```bash
make dev                                  # builds nature-postgres:16-3.4-h3, starts postgres + minio, migrates, runs the API
curl -s localhost:3000/health             # {"status":"ok","db":"ok","version":"0.1.0"}
curl -s localhost:3000/openapi.json | jq '.openapi, .paths | keys'   # "3.1.0", ["/health"] (+ "/openapi.json" if self-described)
docker compose -f infra/docker-compose.yml exec postgres psql -U nature -d nature -c '\dt' \
  | grep -c -E 'factions|users|walk_sessions|location_samples|hex_state|captures|species'   # ≥ 7
docker compose -f infra/docker-compose.yml exec postgres psql -U nature -d nature \
  -c "select partstrat from pg_partitioned_table pt join pg_class c on c.oid=pt.partrelid where relname='location_samples'"  # r (range)
make test                                 # rules + API tests against the running Postgres
make down
```

API logs at startup contain `reckoning.weekly scheduled (0 22 * * 0 UTC)`; a manual trigger (`pnpm --filter @nature/api run job:reckoning`) logs `reckoning.weekly: no work`.

Without Docker (agent containers):

```bash
SKIP_DB_TESTS=1 pnpm --filter @nature/api test    # unit tests pass; integration suites print "skipped: SKIP_DB_TESTS=1"
pnpm --filter @nature/api typecheck && pnpm --filter @nature/api lint
```

CI: open a pull request; `.github/workflows/api.yml` jobs `rules` and `api` are green; the `api` job shows the Postgres image built from `infra/docker/postgres` and `psql -c 'select h3_get_resolution(...)'` succeeding (h3-pg present).

## C. iOS shell (User Story 3)

Linux or macOS (no Xcode needed):

```bash
cd apps/ios/Packages/H3Kit && swift test           # latLngToCell / parents / boundary / polygonToCells vs fixtures
cd ../TerritoryRules && swift test                 # same four fixtures as Stream A
grep -rl 'import UIKit\|import SwiftUI\|import MapLibre' apps/ios/Packages/H3Kit apps/ios/Packages/TerritoryRules   # expected: no output
```

macOS with Xcode 16:

```bash
cd apps/ios
xcodegen generate                                   # no "missing file" warnings
xcodebuild test -scheme NatureExplorer -destination 'platform=iOS Simulator,name=iPhone 16' | tail -5   # ** TEST SUCCEEDED **
open NatureExplorer.xcodeproj                       # run: five tabs; Map tab shows Kaunas at zoom 12 with a basemap
```

Xcode Cloud (after the owner connects the repo): the PR workflow runs `ci_scripts/ci_post_clone.sh` (installs XcodeGen and git-lfs, generates the project, pulls LFS) and the unit tests pass in < 20 min.

## D. Models and licences (User Story 4)

```bash
python3 -m unittest discover -s ml/tests -v                  # manifest schema + licence policy tests
python3 ml/scripts/download_models.py --only birdnet-geomodel --record   # downloads to ml/models/cache, fills sha256
python3 ml/scripts/download_models.py --skip-download                    # re-verifies: "OK <name> <sha256>" per file, exit 0
git check-attr filter -- apps/ios/Resources/Models/x.onnx                # filter: lfs
grep -n 'OpenFreeMap\|H3 C core' docs/licences.md                        # rows present
ls ml/licensing                                                          # birdnet-v24-inquiry.md plantnet-pro-inquiry.md
```

If the container has no network, the script exits 3 with the URL it could not fetch, and the manifest keeps `sha256: null` — the task notes this in the report.

## E. Integration (whole feature)

```bash
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test         # every workspace green (DB tests need Docker or DATABASE_URL)
make test                                        # with Docker
git ls-files | grep -c '^apps/ios/.*\.xcodeproj' # 0 — generated project is ignored
git lfs ls-files                                 # lists the committed .onnx files (if weights were committed)
export SPECIFY_FEATURE=001-repo-foundations SPECIFY_FEATURE_DIRECTORY=specs/001-repo-foundations
.specify/scripts/bash/check-prerequisites.sh --json --include-tasks   # lists plan, research, data-model, contracts, quickstart, tasks
```

Then run `/speckit-analyze` and `/speckit-converge` until Converged (SC-004). Phase 0 exit criteria (`docs/roadmap.md`): `pnpm test` green on GitHub Actions, `xcodebuild test` green on Xcode Cloud, identical fixture results in TS and Swift, `make dev` runs API + DB.
