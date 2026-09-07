# Quickstart: Auth and Factions

How a reviewer or agent verifies feature `002-auth-and-factions`. Sections map to the streams in `tasks.md`; the last section is the whole-feature check. Commands run from the repository root unless stated. Shapes: `data-model.md`; endpoints: `contracts/openapi.yaml`.

## Prerequisites

| Tool | Needed by | Notes |
|---|---|---|
| Node 22, pnpm 10 | A, C | always |
| Postgres 16 + PostGIS reachable as a superuser | A (integration suites), C | agent container: `DATABASE_URL=postgres://nature:nature@localhost:5432/nature`; otherwise Docker via `make dev` / Testcontainers; `SKIP_DB_TESTS=1` skips |
| MinIO (Docker) | optional | only for the S3 integration test (`S3_TEST=1`) and the end-to-end export download; unit tests use the in-memory storage |
| Swift 6 toolchain (Linux or macOS) | B | `swift test` for `Packages/Core` (+ `H3Kit`, `TerritoryRules` regression) |
| Xcode 16 + XcodeGen | B (app), C | macOS only; generation of the OpenAPI client happens at build time |
| `jq`, `curl` | A | for the flows below |

Spec Kit scripts need `export SPECIFY_FEATURE=002-auth-and-factions SPECIFY_FEATURE_DIRECTORY=specs/002-auth-and-factions`.

## A. API (Stream A)

### A.1 Unit and integration suites

```bash
pnpm install --frozen-lockfile
pnpm turbo run build --filter=@nature/api...
SKIP_DB_TESTS=1 pnpm --filter @nature/api test                      # unit: apple verifier (local JWKS), tokens, rate limit, storage, rules, display name, purge registry, export sections, jobs registry
DATABASE_URL=postgres://nature:nature@localhost:5432/nature pnpm --filter @nature/api test   # + integration: auth, factions, me, delete-purge, export, schema (migration 0003)
pnpm --filter @nature/api lint && pnpm --filter @nature/api typecheck
```

Expected: every suite green; with `SKIP_DB_TESTS=1` the integration files print `skipped: … SKIP_DB_TESTS=1`. The schema test lists `account_exports` and the `users_faction_active_idx` index. The purge-registry test prints the FK coverage table (every FK to `users` is `cascade`, `set null` or covered by a step).

### A.2 Manual flow with the Apple stub (no Apple account needed)

```bash
# terminal 1: local JWKS + token minting
pnpm --filter @nature/api dev:apple-stub --port 4567 --sub stub-user-1 --email stub@example.com
#   prints: JWKS at http://localhost:4567/keys and an identity token (copy it to $IDT)

# terminal 2: API against the local database (migrations included)
export DATABASE_URL=postgres://nature:nature@localhost:5432/nature JWT_SECRET=dev-secret-dev-secret-dev-secret-0123 \
       APPLE_JWKS_URL=http://localhost:4567/keys APPLE_CLIENT_IDS=com.natureexplorer.app JOBS_ENABLED=true
pnpm --filter @nature/api db:migrate && pnpm --filter @nature/api dev

# terminal 3
curl -s localhost:3000/v1/factions | jq '.suggestedFactionId, [.factions[] | {id, stats}]'     # 1 and zero stats in an empty world
curl -s -X POST localhost:3000/v1/auth/apple -H 'content-type: application/json' \
  -d "{\"identityToken\":\"$IDT\",\"fullName\":{\"givenName\":\"Tadas\"}}" | tee /tmp/auth.json | jq '.isNewUser, .me.displayName, .me.factionId'
ACCESS=$(jq -r .tokens.accessToken /tmp/auth.json); REFRESH=$(jq -r .tokens.refreshToken /tmp/auth.json)
curl -s localhost:3000/v1/me -H "authorization: Bearer $ACCESS" | jq '.suggestedFactionId, .factionChangeAvailableAt'   # 1, null
curl -s -X POST localhost:3000/v1/me/faction -H "authorization: Bearer $ACCESS" -H 'content-type: application/json' -d '{"factionId":3}' | jq '.factionId, .factionChangedAt'   # 3, null (first pick free)
curl -s -X POST localhost:3000/v1/me/faction -H "authorization: Bearer $ACCESS" -H 'content-type: application/json' -d '{"factionId":2}' | jq '.factionId, .factionChangeAvailableAt'   # 2, ~30 days ahead
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:3000/v1/me/faction -H "authorization: Bearer $ACCESS" -H 'content-type: application/json' -d '{"factionId":1}'   # 409
curl -s -X PATCH localhost:3000/v1/me -H "authorization: Bearer $ACCESS" -H 'content-type: application/json' -d '{"displayName":"  Ąžuolas  "}' | jq .displayName    # "Ąžuolas"
curl -s -X PATCH localhost:3000/v1/me -H "authorization: Bearer $ACCESS" -H 'content-type: application/json' -d '{"displayName":"A"}' | jq '.error.code, .error.details.rule'   # VALIDATION_FAILED, tooShort
curl -s -X POST localhost:3000/v1/auth/refresh -H 'content-type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}" | jq -r .refreshToken > /tmp/r2   # rotated
curl -s -X POST localhost:3000/v1/auth/refresh -H 'content-type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}" | jq .error.code   # REFRESH_REUSED (all sessions revoked)
curl -s -X POST localhost:3000/v1/auth/refresh -H 'content-type: application/json' -d "{\"refreshToken\":\"$(cat /tmp/r2)\"}" | jq .error.code   # INVALID_REFRESH_TOKEN (revoked by the reuse)
for i in $(seq 1 25); do curl -s -o /dev/null -w '%{http_code} ' -X POST localhost:3000/v1/auth/refresh -H 'content-type: application/json' -d '{"refreshToken":"x"}'; done; echo   # …401 then 429 after 20/min
```

Sign in again (new `$IDT` from the stub, same `--sub`) → `isNewUser: false`, the display name and faction are kept. Logs (terminal 2) never show `stub@example.com` or a token: `grep -c 'stub@example.com' <api log>` is 0.

### A.3 Deletion, restore and purge

```bash
curl -s -X DELETE localhost:3000/v1/me -H "authorization: Bearer $ACCESS" | jq .purgeAt          # 30 days ahead
curl -s localhost:3000/v1/me -H "authorization: Bearer $ACCESS" | jq .error.code                  # ACCOUNT_DELETED
# restore: sign in again with the same sub → restored: true; delete again for the purge test, then back-date:
psql "$DATABASE_URL" -c "update users set deleted_at = now() - interval '31 days' where apple_sub = 'stub-user-1'"
pnpm --filter @nature/api job:purge -- --user <user id>      # logs purged: true with the step table; second run logs purged: false
psql "$DATABASE_URL" -tA -c "select count(*) from users where apple_sub = 'stub-user-1'"        # 0
```

### A.4 Export

```bash
curl -s localhost:3000/v1/me/export -H "authorization: Bearer $ACCESS" | jq .status              # pending (202)
pnpm --filter @nature/api job:export -- --user <user id>     # needs MinIO (make dev): the CLI uses the real S3 storage and the bundle lands in nature-media/exports/
curl -s localhost:3000/v1/me/export -H "authorization: Bearer $ACCESS" | jq '.status, .downloadUrl'   # ready, presigned URL
curl -s "$(curl -s localhost:3000/v1/me/export -H "authorization: Bearer $ACCESS" | jq -r .downloadUrl)" | jq '.exportVersion, .account.displayName, (.sessions | length)'
```

Without Docker/MinIO the export path is proven by `test/integration/export.test.ts` (job run in-process with `MemoryObjectStorage`) — that suite is the acceptance check.

### A.5 OpenAPI snapshot

```bash
pnpm --filter @nature/api openapi:print | jq '.paths | keys'      # /health, /openapi.json, /v1/auth/apple, /v1/auth/refresh, /v1/auth/logout, /v1/factions, /v1/me, /v1/me/faction, /v1/me/export
pnpm --filter @nature/api-schema snapshot && git diff --stat packages/api-schema/openapi.json   # regenerates; empty diff when current
pnpm --filter @nature/api-schema test                              # stale-snapshot test + iOS-copy equality (skipped until Stream C syncs)
```

Mutation check (SC-007): change a `description` on any route in `apps/api/src/modules/me/routes.ts`, run the test again → fails with "openapi.json is stale"; revert.

### A.6 Infra

```bash
docker compose -f infra/docker-compose.yml config | grep -A3 'mc ilm'     # lifecycle rule exports/ 7 days in minio-init
make dev && curl -s localhost:3000/health                                   # on a Docker machine; then run A.2–A.4 with real MinIO
S3_TEST=1 S3_ENDPOINT=http://localhost:9000 pnpm --filter @nature/api test -- storage   # S3 integration test against MinIO
```

## B. iOS (Stream B)

Linux or macOS without Xcode:

```bash
cd apps/ios/Packages/Core && swift test                                   # AuthSession state machine, validators, presentation
grep -rl 'import UIKit\|import SwiftUI\|import AuthenticationServices\|import Security' apps/ios/Packages/Core   # expected: no output
cd ../H3Kit && swift test && cd ../TerritoryRules && swift test           # 001 regression
```

Expected `CoreTests`: refresh success, refresh failure → signed out and store cleared, concurrent `validAccessToken()` calls coalesce into one refresh, restore from store at launch, 30 s expiry skew, sign-out clears the store even when logout fails; `DisplayNameValidatorTests` pass the vector of `data-model.md` §2.7; `FactionChangeLockTests` (`free` / `locked(until)`); `FactionPickPresentationTests` (suggested flag, current flag, ordering, confirm disabled while locked); `ExportPresentationTests`.

macOS with Xcode 16:

```bash
cd apps/ios
./scripts/sync-openapi.sh                                                # copies packages/api-schema/openapi.json into Packages/APIClient/Sources/APIClient/
xcodegen generate                                                        # no missing-file warnings; Sign in with Apple entitlement listed
xcodebuild test -scheme NatureExplorer -destination 'platform=iOS Simulator,name=iPhone 16' | tail -5   # ** TEST SUCCEEDED ** (generator plugin runs during the build)
```

Run in the simulator (signed into an Apple ID) with the API from A.2 (`API_BASE_URL` in `Info.plist` = `http://localhost:3000`, `APPLE_CLIENT_IDS` = the bundle id): sign in → faction pick shows three cards with zero stats, Owls pre-selected and labelled "Fewest active players" → confirm → six tabs. Profile: edit name (inline validation), sign out (back to sign-in), delete (two-step confirmation → sign-in screen), export (pending → download button). Force-quit and relaunch → still signed in. Kill the API and relaunch → still signed in (offline restore), requests fail gracefully.

Record what was verified where in `apps/ios/VERIFY.md` (Linux vs macOS).

## C. Integration (whole feature)

```bash
pnpm install                                                             # regenerates pnpm-lock.yaml with the new dependencies
pnpm lint && pnpm typecheck && pnpm test                                 # unit everywhere; DB suites skipped
DATABASE_URL=postgres://nature:nature@localhost:5432/nature pnpm test:db  # with the DB suites
pnpm --filter @nature/api-schema snapshot && apps/ios/scripts/sync-openapi.sh && pnpm --filter @nature/api-schema test   # snapshot + iOS copy equal
git diff --exit-code packages/api-schema/openapi.json apps/ios/Packages/APIClient/Sources/APIClient/openapi.json   # nothing left to commit
cd apps/ios/Packages/Core && swift test && cd -
python3 -m unittest discover -s ml/tests -v                              # unchanged, still green
grep -n 'once per 30 days\|14 days' docs/territory-rules.md              # both rows present after T029
export SPECIFY_FEATURE=002-auth-and-factions SPECIFY_FEATURE_DIRECTORY=specs/002-auth-and-factions
.specify/scripts/bash/check-prerequisites.sh --json --include-tasks      # lists research, data-model, contracts, quickstart, tasks
```

Then run `/speckit-analyze` (report in `analysis.md`) and `/speckit-converge` until Converged. macOS-only items (T026 app run, Xcode Cloud) are recorded as follow-up tasks if no macOS machine is available, as in 001.

### Verification log

| Date | Commit | API (`pnpm --filter @nature/api test` with DB) | `@nature/api-schema` | Swift `Core` | Where |
|---|---|---|---|---|---|
| _(filled by Stream C)_ | | | | | |

## Owner actions

- Enable Sign in with Apple on the App ID and set `APPLE_CLIENT_IDS` to the real bundle id(s) (placeholder `com.natureexplorer.app`, `TODO(owner)`).
- Generate `JWT_SECRET` per environment; add the `exports/` lifecycle rule on the production bucket.
- Feature 009 needs the Sign in with Apple private key for token revocation on erasure.
