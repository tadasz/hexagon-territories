# Data Model: Auth and Factions

**Feature**: `002-auth-and-factions` | **Date**: 2026-09-07

What this feature adds to the 001 schema (`specs/001-repo-foundations/data-model.md` §4), the API resource shapes (TypeBox names as they appear in the generated OpenAPI document), the access-token claims, the export bundle, the job payloads, the iOS `Core` mirrors and the configuration variables. Behavioural rules are in `plan.md` "Shared Semantics"; endpoints are in `contracts/openapi.yaml`.

---

## 1. Postgres changes (`apps/api/drizzle/0003_auth_exports.sql`)

### 1.1 New table `account_exports` [`src/db/schema/exports.ts`]

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` pk default `gen_random_uuid()` | export id; also the pg-boss `singletonKey` |
| `user_id` | `uuid` not null → `users.id` **on delete cascade** | |
| `status` | `export_status` enum `('pending','ready','failed')` not null default `'pending'` | new enum in `enums.ts` |
| `object_key` | `text` | `exports/<user_id>/<id>.json`, set when ready |
| `requested_at` | `timestamptz` not null default `now()` | |
| `completed_at` | `timestamptz` | set on `ready` or `failed` |
| `expires_at` | `timestamptz` | `completed_at + 7 days` when ready |
| `error` | `text` | short machine message on `failed`, no PII |

Indexes: `account_exports_user_requested_idx (user_id, requested_at desc)`.

### 1.2 Existing tables: new indexes, no column changes

| Table | Change |
|---|---|
| `users` | `users_faction_active_idx ON users (faction_id, last_seen_at) WHERE deleted_at IS NULL` (member and active-member counts, R5) |
| `refresh_tokens` | `refresh_tokens_expires_idx ON refresh_tokens (expires_at)` (opportunistic cleanup, R2). Semantics of existing columns: `token_hash` = `sha256(refreshToken)` as `bytea`; `revoked_at` set on rotation, logout, reuse-revocation and account deletion; `device_id` stays null in 002 |

Drizzle: `src/db/schema/index.ts` re-exports `exports.ts`; `drizzle/meta/_journal.json` + `0003_snapshot.json` updated by `db:generate` (then hand-checked — no `location_samples` changes may appear, `tablesFilter` excludes it).

### 1.3 Entity lifecycles

**Player (`users`)**

```text
(none) --sign-in, unknown sub--> active(faction_id null)
active(faction null) --POST /v1/me/faction--> active(faction set, faction_changed_at null)
active --POST /v1/me/faction (allowed)--> active(faction_changed_at = now)
active --DELETE /v1/me--> deleted(deleted_at = now)          # all refresh tokens revoked
deleted --sign-in same sub within 30 d--> active            # deleted_at cleared, nothing else changes
deleted --account.purge, deleted_at <= now - 30 d--> (row gone; cascades + purge steps)
(none) --sign-in same sub after purge--> active(new id)
```

**Refresh token (`refresh_tokens`)**

```text
issued(revoked_at null) --refresh--> revoked_at = now, successor issued
issued --logout / DELETE /v1/me / reuse detected on another token--> revoked_at = now
revoked --presented again--> REUSE: all of user's tokens revoked
any --expires_at < now - 7 d or revoked_at < now - 7 d--> deleted (cleanup on the user's next refresh)
```

**Export (`account_exports`)**

```text
(none) --GET /v1/me/export (no pending/fresh)--> pending
pending --account.export ok--> ready(object_key, completed_at, expires_at = completed_at + 7 d)
pending --account.export failed after retries--> failed(error)
ready --expires_at < now--> expired (row kept; next GET creates a new pending row)
failed / expired --GET /v1/me/export--> new pending row
any --account.purge--> row deleted, object deleted
```

---

## 2. API resource shapes (TypeBox `$id` names → OpenAPI component schemas)

All timestamps are ISO 8601 UTC strings. Ids are UUID strings. `additionalProperties: false` everywhere.

### 2.1 Auth

| Schema | Fields |
|---|---|
| `AuthAppleRequest` | `identityToken: string (1–8192)`, `authorizationCode?: string (1–2048)` (accepted, unused in 002), `fullName?: { givenName?: string (≤ 100), familyName?: string (≤ 100) }` |
| `TokenPair` | `accessToken: string`, `accessExpiresAt`, `refreshToken: string`, `refreshExpiresAt` |
| `AuthResponse` | `tokens: TokenPair`, `me: Me`, `isNewUser: boolean`, `restored: boolean` (true when a deleted account was reactivated) |
| `RefreshRequest` | `refreshToken: string (1–256)` |
| `LogoutRequest` | `refreshToken: string (1–256)` |

### 2.2 Me

| Schema | Fields |
|---|---|
| `Me` | `id`, `displayName: string`, `factionId: integer \| null`, `factionChangedAt: string \| null`, `factionChangeAvailableAt: string \| null` (null = a change is allowed now, or no faction yet), `xp: integer`, `level: integer`, `role: 'player' \| 'tester' \| 'admin'`, `createdAt`, `suggestedFactionId: integer` |
| `MeUpdate` | `displayName: string (1–64 raw; validated to 2–24 after trimming by the service, not by JSON schema, so the error names the rule)` |
| `FactionSelect` | `factionId: integer (1–32767)` |
| `AccountDeletion` | `deletedAt`, `purgeAt` |
| `ExportStatus` | `id`, `status: 'pending' \| 'ready' \| 'failed'`, `requestedAt`, `completedAt: string \| null`, `expiresAt: string \| null`, `downloadUrl: string \| null` (only when `ready`; valid 1 h), `error: string \| null` |

### 2.3 Factions

| Schema | Fields |
|---|---|
| `Faction` | `id: integer`, `slug`, `name`, `emoji`, `colorLight: '#RRGGBB'`, `colorDark`, `sort: integer`, `stats: FactionStats` |
| `FactionStats` | `members: integer ≥ 0`, `activeMembers: integer ≥ 0`, `hexesOwnedR9: integer ≥ 0`, `hexesOwnedR7: integer ≥ 0` |
| `FactionsResponse` | `factions: Faction[]` (sorted by `sort`, then `id`), `suggestedFactionId: integer`, `activeWindowDays: integer` (14; informational, lets the client label "active in the last N days" without hard-coding) |

### 2.4 Shared (from 001)

`Error` envelope unchanged: `{ error: { code, message, details? }, requestId }`.

### 2.5 Security

Component `securitySchemes.bearerAuth: { type: http, scheme: bearer, bearerFormat: JWT }`. Applied per operation (`security: [{bearerAuth: []}]`) on every `/v1/me*` route and `/v1/auth/logout`. `/v1/auth/apple`, `/v1/auth/refresh`, `/v1/factions`, `/health`, `/openapi.json` are unauthenticated.

### 2.6 Error codes added to `apps/api/src/errors.ts`

| Code | HTTP | Where |
|---|---|---|
| `UNAUTHORIZED` | 401 | missing/invalid bearer token |
| `TOKEN_EXPIRED` | 401 | access token past `exp` |
| `ACCOUNT_DELETED` | 401 | account has `deleted_at` (authenticated routes and refresh) |
| `INVALID_APPLE_TOKEN` | 401 | identity token fails verification (`details.reason`) |
| `APPLE_UNAVAILABLE` | 503 | Apple JWKS unreachable |
| `INVALID_REFRESH_TOKEN` | 401 | unknown, expired or revoked-without-successor refresh token |
| `REFRESH_REUSED` | 401 | rotated token presented again; all sessions revoked |
| `FORBIDDEN` | 403 | reserved (role checks; unused in 002 routes) |
| `FACTION_NOT_FOUND` | 404 | unknown faction id |
| `FACTION_CHANGE_LOCKED` | 409 | `details.nextChangeAt` |
| `RATE_LIMITED` | 429 | `details.retryAfterS`; `retry-after` header |
| `EXPORT_FAILED` | 500 | reserved for the job's failure text; the route itself returns `ExportStatus.error` |

Existing: `VALIDATION_FAILED` (400), `NOT_FOUND` (404), `INTERNAL_ERROR` (500), `DB_UNAVAILABLE` (503).

### 2.7 Display-name rule (server `modules/me/display-name.ts` and iOS `Core/Validation/DisplayNameValidator.swift`)

Input → trim (Unicode `White_Space`) → reject if any scalar is a control character (`Cc`) → count Unicode scalars → accept iff 2 ≤ n ≤ 24. Shared test vector (both suites):

| Input | Result |
|---|---|
| `"Ąžuolas"` | ok `"Ąžuolas"` |
| `"  Tadas  "` | ok `"Tadas"` |
| `"A"` | too short |
| `"   "` | too short (0) |
| `"abcdefghijklmnopqrstuvwxyz"` (26) | too long |
| 24 × `"ž"` | ok |
| 25 × `"ž"` | too long |
| `"Ta\nDas"` | control character |
| `"🦉 Owl"` | ok (emoji counts as one scalar) |

---

## 3. Access token claims (HS256)

```jsonc
{ "iss": "nature-api", "aud": "nature-ios", "sub": "<user uuid>", "role": "player", "iat": 1757203200, "exp": 1757204100 }
```

`exp - iat = JWT_ACCESS_TTL_S` (900). No other claims; faction and display name are read from `GET /v1/me`, so a faction change never requires a new token.

---

## 4. Export bundle (`exports/<userId>/<exportId>.json`, format version 1)

```jsonc
{
  "exportVersion": 1,
  "generatedAt": "2026-09-07T10:00:00.000Z",
  "account": {
    "id": "…", "appleUserId": "<apple sub>", "email": "…|null", "displayName": "…",
    "factionId": 2, "factionChangedAt": null, "xp": 0, "level": 1, "role": "player",
    "createdAt": "…", "lastSeenAt": "…", "deletedAt": null
  },
  "factions": [ { "id": 1, "slug": "owls", "name": "Owls" }, … ],          // reference data so factionId is readable
  "sessions": [ { "issuedAt": "…", "expiresAt": "…", "revokedAt": null } ] // refresh-token metadata, never the tokens
  // later features append: "walks", "captures", "collection", "points", "devices"
}
```

`ExportSection` registry (`modules/me/export-sections.ts`): `{ name: string; run(db, userId): Promise<unknown> }`; sections are emitted in registration order; the job asserts unique names.

---

## 5. Job payloads (pg-boss)

| Job | Data | Options | Handler contract |
|---|---|---|---|
| `account.purge` | `{ userId: string, deletedAt: string }` | `startAfter: deletedAt + 30 d`, `singletonKey: userId`, `retryLimit: 5`, `retryBackoff: true` | no-op unless `users.deleted_at IS NOT NULL AND deleted_at <= now() - 30 d`; runs the purge registry in one transaction (storage deletions before the transaction); returns `{ userId, purged: boolean, steps: [{name, rows}] }` |
| `account.export` | `{ exportId: string, userId: string }` | `singletonKey: exportId`, `retryLimit: 3` | no-op unless the export is `pending`; builds §4, writes storage, marks `ready`; on the final failed attempt marks `failed` |
| `reckoning.weekly` | unchanged from 001 | | |

`src/jobs/index.ts`: `registerJobs(boss, deps)` calls the three registrations; `src/jobs/run.ts` accepts `reckoning.weekly`, `account.purge --user <id>`, `account.export --user <id>` (creates a pending export first).

---

## 6. iOS `Core` models and states (Swift, Foundation-only)

| Type | Shape |
|---|---|
| `Me` | mirrors §2.2 `Me` (`Codable`, `Sendable`, `Equatable`); `factionChangeAvailableAt: Date?` |
| `Faction`, `FactionStats`, `FactionsResponse` | mirror §2.3 |
| `TokenPair` | `accessToken`, `accessExpiresAt: Date`, `refreshToken`, `refreshExpiresAt: Date` (`Codable`, stored as JSON in the Keychain item) |
| `ExportStatus` | mirrors §2.2 (`status: ExportState` enum) |
| `AccountDeletion` | `deletedAt`, `purgeAt` |
| `AppleSignInPayload` | `identityToken: String`, `authorizationCode: String?`, `fullName: PersonName?` (`givenName?`, `familyName?`) |
| `APIError` | `unauthorized`, `tokenExpired`, `accountDeleted`, `invalidAppleToken(reason: String?)`, `appleUnavailable`, `invalidRefreshToken`, `refreshReused`, `factionNotFound`, `factionChangeLocked(nextChangeAt: Date)`, `rateLimited(retryAfterS: Int?)`, `validation(message: String)`, `network(underlying: Error)`, `unexpected(code: String, status: Int)` |
| `AuthState` | `.signedOut`, `.signedIn(TokenPair)`, `.refreshing` |
| protocols | `AuthService { signInWithApple(_:) async throws -> AuthResult; refresh(refreshToken:) async throws -> TokenPair; logout(refreshToken:) async throws }`, `FactionsService { factions() async throws -> FactionsResponse }`, `ProfileService { me(); updateDisplayName(_:); selectFaction(_:); deleteAccount(); export() }`, `TokenStore { load() throws -> TokenPair?; save(_:) throws; clear() throws }`, `Clock { now() -> Date }` |
| presentation | `FactionChangeLock` (`.free` / `.locked(until: Date)` from `Me`), `FactionPickPresentation.rows(response:me:)` → `[FactionRow {faction, isSuggested, isCurrent}]` + `confirmEnabled`, `DisplayNameValidator.validate(_:) -> Result<String, DisplayNameError>`, `ExportPresentation` (`.idle`, `.pending(since:)`, `.ready(url:expiresAt:)`, `.failed(message:)`, `.timedOut`) |

---

## 7. Configuration variables added to `apps/api/src/config.ts` / `.env.example`

| Variable | Type / default | Purpose |
|---|---|---|
| `JWT_SECRET` | string, min 32 chars, **required** (`.env.example` ships a dev value; tests set their own) | HS256 signing key |
| `JWT_ACCESS_TTL_S` | integer, default 900 | access token lifetime |
| `REFRESH_TTL_DAYS` | integer, default 60 | refresh token lifetime |
| `APPLE_CLIENT_IDS` | comma-separated, default `com.natureexplorer.app` | accepted `aud` values |
| `APPLE_JWKS_URL` | URL, default `https://appleid.apple.com/auth/keys` | overridable for tests/stub |
| `AUTH_RATE_LIMIT_PER_MIN` | integer, default 20 | `/v1/auth/*` per-IP limit |
| `ACCOUNT_PURGE_GRACE_DAYS` | integer, default 30 | deletion grace period |
| `EXPORT_TTL_DAYS` | integer, default 7 | bundle retention |
| `EXPORT_URL_TTL_S` | integer, default 3600 | presigned GET validity |
| `S3_REGION` | string, default `eu-central-1` | SDK region (arbitrary for path-style endpoints) |
| `S3_PUBLIC_ENDPOINT` | URL, optional | endpoint used inside presigned URLs when it differs from `S3_ENDPOINT` |
| `TRUST_PROXY` | boolean, default false | Fastify `trustProxy` (rate-limit keys by real client IP behind Caddy in 009) |

Existing `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` are reused. `config.ts` keeps `AppConfig` flat groups: `jwt`, `apple`, `s3`, `account`, `rateLimit`. The unit test `config.test.ts` gains cases for the required secret and the comma list.
