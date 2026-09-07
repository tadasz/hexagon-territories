# @nature/api-schema

The committed snapshot of the Nature Explorer API's generated OpenAPI 3.1 document
(`openapi.json`) — the merge target the constitution names for API contracts and the source the
iOS `APIClient` package is generated from (`specs/002-auth-and-factions/research.md` R10).

| Command | What it does |
|---|---|
| `pnpm --filter @nature/api-schema snapshot` | boots `@nature/api` without a database (`openapi:print`), formats the document with the repository's Prettier settings and writes `openapi.json` |
| `pnpm --filter @nature/api-schema test` | fails with `openapi.json is stale — run …` when a route changed without a new snapshot; also checks that `apps/ios/Packages/APIClient/Sources/APIClient/openapi.json` equals the snapshot when that copy exists |

Workflow when a route or schema changes: edit `apps/api`, run the snapshot, run
`apps/ios/scripts/sync-openapi.sh`, commit both files. `src/index.ts` exports only
`OPENAPI_PATH` and `readOpenApiDocument()`; error codes are read from
`components.schemas.Error.properties.error.properties.code.examples`.
