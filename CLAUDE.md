# Nature Explorer — guide for coding agents

This repository is developed with **GitHub Spec Kit**. Before touching code:

1. Read `.specify/memory/constitution.md` (binding principles) and `docs/architecture.md` (the agreed stack and system design).
2. Find the feature you are working on under `specs/NNN-name/`. Work only inside its `tasks.md`; if the feature has no `plan.md` or `tasks.md` yet, run `/speckit-plan` and `/speckit-tasks` first.
3. Territory scoring and ownership rules are defined in `docs/territory-rules.md`. Change the shared fixtures in `packages/h3-fixtures` first, then the TypeScript rules (`packages/territory-rules`), then the Swift port (`apps/ios/Packages/TerritoryRules`), then the doc. The constants test in both packages fails if `config.ts` / `Rules.swift` and the doc disagree.
4. Never add a model, dataset, tile source or species image without a licence entry (`ml/models/manifest.json` or `docs/licences.md`).
5. The API contract is the generated OpenAPI document. Change a route → `pnpm --filter @nature/api-schema snapshot` → `apps/ios/scripts/sync-openapi.sh`; commit both `packages/api-schema/openapi.json` and `apps/ios/Packages/APIClient/Sources/APIClient/openapi.json` (the `@nature/api-schema` test fails while either is stale). Never edit those JSON files by hand and never commit generated Swift client code.
6. Finish every feature with `/speckit-analyze` (write the report to `specs/NNN-name/analysis.md`) and `/speckit-converge`.

Spec Kit skills installed for Claude Code: `/speckit-constitution`, `/speckit-specify`, `/speckit-clarify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-analyze`, `/speckit-checklist`, `/speckit-implement`, `/speckit-converge`, `/speckit-taskstoissues`.

To point Spec Kit at a feature without switching branches, set both variables before any `.specify/scripts/bash/*.sh` script or skill: `export SPECIFY_FEATURE=001-repo-foundations SPECIFY_FEATURE_DIRECTORY=specs/001-repo-foundations`.

## Commands (repository root)

| Command | What it does |
|---|---|
| `pnpm install --frozen-lockfile` | workspace install (`apps/*`, `packages/*`); `pnpm-lock.yaml` is committed |
| `pnpm lint` | `turbo run lint` (type-aware ESLint per workspace) + `prettier --check .` |
| `pnpm typecheck` | `tsc --noEmit` per workspace (builds dependencies first) |
| `pnpm test` | every workspace's tests with `SKIP_DB_TESTS=1` — DB integration suites are reported as skipped |
| `pnpm test:db` | the same with the DB suites; needs `DATABASE_URL` (a Postgres 16 + PostGIS superuser) or Docker (Testcontainers) |
| `make dev` / `make test` / `make down` | Docker Compose stack (`infra/docker-compose.yml`): run the API, run all tests against it, tear down |
| `pnpm --filter @nature/api openapi:print` | prints the generated OpenAPI document without a database |
| `pnpm --filter @nature/api-schema snapshot` then `apps/ios/scripts/sync-openapi.sh` | refresh the committed snapshot and its copy in the iOS `APIClient` package |
| `pnpm --filter @nature/api dev:apple-stub --port 4567 --sub <sub>` | local JWKS server + Sign in with Apple identity token for manual testing (`APPLE_JWKS_URL=http://localhost:4567/keys`) |
| `pnpm --filter @nature/api job:purge -- --user <id>` / `job:export -- --user <id>` | run the account purge / export job once against `DATABASE_URL` (export needs MinIO) |
| `swift test` in `apps/ios/Packages/H3Kit` and `.../TerritoryRules` | Swift side of the rules, Linux or macOS; the app target needs macOS (`apps/ios/README.md`, `apps/ios/VERIFY.md`) |
| `swift test` in `apps/ios/Packages/{Core,APIClient,AuthFeature,FactionsFeature,ProfileFeature,DesignSystem}` | auth session, generated client, view models; Linux or macOS (SwiftUI/Keychain code is behind `canImport` and is only type-checked on macOS) |
| `python3 -m unittest discover -s ml/tests -v` | model manifest and download-script tests (stdlib only) |

Every TypeScript workspace exposes `build`, `test`, `lint`, `typecheck`, `clean`; turbo runs them from the root. Formatting is Prettier (`pnpm format`); `.prettierignore` excludes generated files (`apps/api/drizzle/meta`, `pnpm-lock.yaml`, `.specify`).

## Parallel agents (stream ownership)

When a feature's `tasks.md` splits work into streams, each agent edits **only the paths listed for its stream** in the "Stream ownership" table and never the root files (`package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.gitignore`, `README.md`, `CLAUDE.md`, `pnpm-lock.yaml`, lint/format configs) — those belong to the integration stream, which runs after the others are merged. Install dependencies package-locally if you must, but do not hand over `node_modules`, `dist` or a lockfile; the integration stream regenerates them. Without Docker run `SKIP_DB_TESTS=1`; without Swift review Swift changes by file list and note it in the PR; without git-lfs never commit raw `.onnx`/`.tflite` files.

Roadmap and feature backlog: `docs/roadmap.md`. MVP scope: `docs/mvp.md`. Decisions: `docs/adr/`. Licences: `docs/licences.md`.

The original web prototype lives in `prototype/index.html` (Leaflet + h3-js); it is reference only and is not built or deployed.
