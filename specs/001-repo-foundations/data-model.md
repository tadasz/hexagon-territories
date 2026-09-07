# Data Model: Repo Foundations

**Feature**: `001-repo-foundations` | **Date**: 2026-09-07

Three data contracts are created by this feature: (1) the JSON fixtures consumed by both rule implementations, (2) the model manifest, (3) the Postgres schema migrated by the API skeleton (the full `docs/architecture.md` §6, made concrete here with column types, keys and indexes). Behavioural semantics of the rule functions are in `plan.md` "Shared Rule Semantics"; game constants come from `docs/territory-rules.md` and are not repeated.

---

## 1. Fixtures (`packages/h3-fixtures/fixtures/*.json`)

### 1.1 Envelope (every fixture)

```jsonc
{
  "name": "walk-paths",                      // == file name without .json
  "description": "Six synthetic paths ...",  // human summary
  "generator": "scripts/generate.ts#walkPaths", // function that produced it
  "version": 1,                              // bump when the shape (not the values) changes
  "seed": 20260907,                          // PRNG seed used by the generator
  "cases": [ ... ]                           // fixture-specific case objects (below)
}
```

Rules for all fixtures: cells are H3 index strings (`^[0-9a-f]{15}$`); coordinates are `{ "lat": number, "lon": number }` (WGS84 degrees, lat ∈ [-90, 90], lon ∈ [-180, 180]); numbers are finite; `cases[].id` is unique within a file and used in test names; unknown properties are rejected (`additionalProperties: false`). The TypeBox definitions live in `packages/h3-fixtures/src/schema.ts` and are exported to `packages/h3-fixtures/schema/<name>.schema.json` by the generator. Swift mirrors them as `Codable` structs in `apps/ios/Packages/TerritoryRules/Tests/TerritoryRulesTests/Fixtures.swift` (also used by `H3KitTests`).

### 1.2 `latlng-to-cell.json` — 200 cases

```jsonc
{
  "id": "kaunas-town-hall",                  // or "lt-random-017"
  "input": { "lat": 54.8969, "lon": 23.8862 },
  "expected": {
    "r9": "891f1d4a2c3ffff",
    "parents": { "r8": "881f1d4a2dfffff", "r7": "871f1d4a2ffffff", "r6": "861f1d4afffffff", "r5": "851f1d4bfffffff" },
    "boundaryVertexCount": 6                 // 5 for the pentagon case
  }
}
```

Composition: 180 seeded-random points inside the Lithuania bounding box (lat 53.90–56.45, lon 20.90–26.85) + 20 hand-picked: Kaunas landmarks (town hall, Ąžuolynas park, Nemunas island), Vilnius cathedral, Klaipėda, Nida, a point within 1 m of a res-9 cell edge, the antimeridian (lon 179.9999 and -179.9999), both poles (lat ±89.999), the equator/prime meridian origin, and one point inside a res-9 pentagon (the generator finds one via `getPentagons(9)`). Consumers: `@nature/territory-rules` (via h3-js), `H3Kit` tests, `TerritoryRules` (Swift) tests.

### 1.3 `zoom-resolution.json` — 19 cases + 4 edge cases

```jsonc
{ "id": "z12", "input": { "zoom": 12 }, "expected": { "resolution": 7 } }
// edge cases: zoom -1 → 1, 18.7 → 9, 20 → 9, 13.4 → 7
```

### 1.4 `walk-paths.json` — 6 cases

```jsonc
{
  "id": "straight-line",                      // straight-line | edge-hugging | loop-inside-one-cell | noisy-zigzag | teleport | car-speed
  "description": "1.2 km NE across ~5 cells, 1 sample per 5 s",
  "input": {
    "resolution": 9,
    "simplifyToleranceM": 5,
    "pedometerSteps": 1500,                   // optional
    "samples": [
      { "seq": 0, "ts": "2026-09-07T08:00:00Z", "lat": 54.9, "lon": 23.9, "hAcc": 8, "speed": 1.4, "course": 45, "alt": 60 }
      // speed/course/alt optional (null or absent)
    ]
  },
  "expected": {
    "acceptedSeqs": [0, 1, 2],                // after acceptSamples
    "rejected": [{ "seq": 3, "reason": "accuracy" }],   // reasons: accuracy | speed | non_monotonic
    "flags": ["teleport"],                    // [] when clean; values: teleport | speed | distance | no_steps
    "distanceM": 1187.4,                      // haversine length of the simplified accepted path
    "simplifiedPointCount": 9,
    "hexMeters": [ { "cell": "891f1d4a2c3ffff", "meters": 243.7 } ]   // sorted by cell asc; tolerance ±0.5 m
  }
}
```

Case design: `straight-line` crosses ≥ 4 cells with one segment that crosses two boundaries (sparse sample); `edge-hugging` runs along a cell edge so both neighbours get metres; `loop-inside-one-cell` yields exactly one cell; `noisy-zigzag` has ±6 m jitter that simplification removes (expected metres computed after DP); `teleport` contains one 400 m jump in 5 s (flag `teleport`, sample kept); `car-speed` has no `speed` values and 15 m/s implied speed (flags `teleport` + `speed`, and `distance` if > 30 km). Each case's `expected` was produced by the generator's reference implementation and hand-checked (`packages/h3-fixtures/README.md` records the review).

### 1.5 `reckoning-weeks.json` — 3 weeks × 8 cells, plus parent cases

```jsonc
{
  "factions": [1, 2, 3],
  "weeks": ["2026-W35", "2026-W36", "2026-W37"],
  "cells": [
    {
      "id": "hysteresis-holds",               // one cell per ownership-table row + cap + decay-to-unclaimed + bonus-only
      "cell": "891f1d4a2c3ffff",
      "initial": { "owner": null, "strengths": [] },
      "weeks": [
        {
          "weekId": "2026-W35",
          "contributions": [                  // raw per (faction,user); the test applies applyWeeklyCap first
            { "factionId": 1, "userId": "u1", "meters": 2600 },
            { "factionId": 1, "userId": "u2", "meters": 300 }
          ],
          "bonuses": [ { "factionId": 2, "userId": "u3", "meters": 300 } ],
          "expected": {
            "capped": [ { "factionId": 1, "userId": "u1", "cappedMeters": 2000 }, { "factionId": 1, "userId": "u2", "cappedMeters": 300 } ],
            "strengths": [ { "factionId": 1, "strength": 2300 }, { "factionId": 2, "strength": 300 } ],   // ±0.01
            "owner": 1,
            "flipped": true,
            "event": { "from": null, "to": 1 }
          }
        }
      ]
    }
  ],
  "parentCases": [
    { "id": "plurality-42pct", "input": { "childOwners": [1, 1, 1, 2, 2, 3, 3, null] }, "expected": { "owner": 1 } },
    { "id": "tie", "input": { "childOwners": [1, 1, 2, 2, null] }, "expected": { "owner": null } },
    { "id": "one-claimed-child", "input": { "childOwners": [1, null, null] }, "expected": { "owner": null } },
    { "id": "no-claimed", "input": { "childOwners": [null, null] }, "expected": { "owner": null } },
    { "id": "exactly-40pct-not-enough", "input": { "childOwners": [1, 1, 2, 3, 2] }, "expected": { "owner": null } }
  ]
}
```

Cell cases (minimum set): `no-faction-reaches-min` (unclaimed), `first-claim`, `challenger-beats-hysteresis` (≥ ×1.10 flips), `hysteresis-holds` (challenger at ×1.05 does not flip), `incumbent-decays-below-min-no-challenger` (→ unclaimed), `exact-tie-incumbent-keeps`, `exact-tie-no-incumbent` (unclaimed), `cap-and-bonus` (2 600 m → 2 000 capped + 300 bonus uncapped). Weeks chain: week N+1 `initial` is week N `expected`.

---

## 2. Rules package types (`@nature/territory-rules` / Swift `TerritoryRules`)

| Type | Fields |
|---|---|
| `LatLng` | `lat: number`, `lon: number` |
| `Sample` | `seq: number`, `ts: string (ISO 8601)`, `lat`, `lon`, `hAcc: number`, `speed?: number \| null`, `course?: number \| null`, `alt?: number \| null` |
| `RejectReason` | `'accuracy' \| 'speed' \| 'non_monotonic'` |
| `WalkFlag` | `'teleport' \| 'speed' \| 'distance' \| 'no_steps'` |
| `HexMeters` | `cell: string`, `meters: number` |
| `Contribution` | `cell: string`, `factionId: number`, `userId: string`, `meters: number` |
| `CappedContribution` | `Contribution & { cappedMeters: number }` |
| `FactionStrength` | `factionId: number`, `strength: number` |
| `ReckonInput` | `cell: string`, `owner: number \| null`, `strengths: FactionStrength[]`, `contributions: { factionId, cappedMeters }[]`, `bonuses: { factionId, meters }[]` |
| `ReckonResult` | `strengths: FactionStrength[]`, `owner: number \| null`, `flipped: boolean`, `event?: { from: number \| null, to: number \| null }` |
| `RULES` | the constants of `docs/territory-rules.md` "Constants summary" plus the walk-acceptance thresholds (`MAX_SAMPLE_HACC_M = 50`, `MAX_SAMPLE_SPEED_MPS = 5`, `TELEPORT_SPEED_MPS = 8`, `MAX_WALK_MEDIAN_SPEED_MPS = 3.5`, `MAX_WALK_DISTANCE_M = 30000`, `MAX_WALK_DURATION_S = 21600`, `MIN_STEPS_PER_M = 0.5`, `NO_STEPS_MIN_DISTANCE_M = 500`) |

Swift uses the same names in camelCase (`Rules.weeklyCapMPerPlayerPerCell`), `Int` for faction ids, `String` for cells at the API boundary and `H3Index` (UInt64) internally.

---

## 3. Model manifest (`ml/models/manifest.json`)

Existing fields are kept; this feature adds `files` and fills `sha256`.

```jsonc
{
  "$comment": "...",
  "models": [
    {
      "name": "birdnet-plus-v3-global-10k-pruned-fp16",   // ^[a-z0-9.-]+$, unique
      "kind": "bird-audio-classifier" | "species-presence" | "plant-image-classifier",
      "version": "3.0-preview3.1",
      "format": "onnx" | "tflite" | "mlmodel",
      "source": "https://...",                             // human-readable origin
      "license": "Apache-2.0 ...",                         // must not contain "NC" / "NON-COMMERCIAL" when role is primary-*
      "attribution": "Powered by BirdNET ...",
      "sample_rate_hz": 32000,                             // required for audio models
      "window_seconds": 3.0,                               // required for audio models
      "hop_seconds": 1.5,                                  // optional
      "inputs": "latitude, longitude, week",               // optional free text for non-audio models
      "labels_file": "labels/birdnet-plus-v3-global-10k.txt",   // relative to ml/models/, optional
      "sha256": "…64 hex…" | null,                         // hash of the primary weights file; null = not yet downloaded
      "role": "primary-on-device" | "primary-server" | "evaluated-fallback" | "evaluation-only",
      "notes": "...",
      "files": [                                           // NEW: every artefact to download/verify
        { "path": "birdnet-plus-v3-global-10k-pruned-fp16.onnx", "url": "https://...", "sha256": "…" | null, "bytes": 12345678 | null, "primary": true },
        { "path": "labels/birdnet-plus-v3-global-10k.txt", "url": "https://...", "sha256": null, "bytes": null }
      ]
    }
  ]
}
```

Validation (`ml/tests/test_manifest.py`): unique names; `role` in the enum; audio models have `sample_rate_hz` and `window_seconds`; exactly one `primary: true` file per model whose `sha256` equals the model-level `sha256`; any model with `role` starting with `primary-` has a licence string without `NC`/`NON-COMMERCIAL`; every `labels_file` referenced exists once downloaded.

---

## 4. Postgres schema migrated by the API skeleton (`apps/api/drizzle/`)

Everything in `docs/architecture.md` §6. Conventions: `timestamptz` for all timestamps; `uuid` primary keys default `gen_random_uuid()`; `created_at` default `now()`; H3 cells `bigint`; PostGIS `geography(LineString,4326)` for paths and `geometry(Polygon,4326)` for cells; text `week_id` in the form `YYYY-Www`. Drizzle file names in brackets.

### 4.1 Extensions and enums [`schema/enums.ts`, `drizzle/0000_init.sql` header]

- `CREATE EXTENSION IF NOT EXISTS postgis;` — required.
- `h3` — optional, guarded (`DO $$ ... EXCEPTION WHEN OTHERS THEN RAISE NOTICE ... $$`).
- Enums: `kingdom('bird','plant')`, `capture_status('created','uploaded','verifying','verified','needs_user_confirm','rejected','failed')`, `ledger_kind('walk_distance','capture_bird','capture_plant','first_species','hex_flip','streak','bonus','adjustment')`, `user_role('player','tester','admin')`, `walk_status('active','finished','flagged','abandoned')`, `candidate_source('device','cloud')`, `reckoning_status('running','done','failed')`.

### 4.2 Identity [`schema/factions.ts`, `schema/users.ts`]

| Table | Columns | Keys / indexes |
|---|---|---|
| `factions` | `id smallint`, `slug text not null`, `name text not null`, `emoji text not null`, `color_light text not null`, `color_dark text not null`, `sort smallint not null` | pk `id`; unique `slug`. Seeded by migration `0002_seed_factions.sql`: `(1,'dog-walker','Dog Walker','🐕','#4CAF50','#2E7D32',1)`, `(2,'cat-person','Cat Person','🐱','#2196F3','#1976D2',2)`, `(3,'fox-trainer','Fox Trainer','🦊','#FFC107','#FFA000',3)` (prototype placeholders) |
| `users` | `id uuid`, `apple_sub text not null`, `email text`, `display_name text not null`, `faction_id smallint → factions`, `faction_changed_at timestamptz`, `xp int not null default 0`, `level smallint not null default 1`, `role user_role not null default 'player'`, `created_at`, `last_seen_at timestamptz`, `deleted_at timestamptz` | pk `id`; unique `apple_sub`; index `(faction_id)`; partial index `(deleted_at) where deleted_at is not null` |
| `refresh_tokens` | `id uuid`, `user_id uuid → users on delete cascade`, `token_hash bytea not null`, `expires_at timestamptz not null`, `revoked_at timestamptz`, `device_id uuid → devices on delete set null` | pk `id`; unique `token_hash`; index `(user_id)` |
| `devices` | `id uuid`, `user_id uuid → users on delete cascade`, `apns_token text`, `app_version text`, `os_version text`, `model text`, `attested boolean not null default false`, `updated_at timestamptz not null default now()` | pk `id`; unique `apns_token`; index `(user_id)` |

### 4.3 Walks [`schema/walks.ts`]

| Table | Columns | Keys / indexes |
|---|---|---|
| `walk_sessions` | `id uuid`, `user_id uuid → users`, `client_walk_id uuid not null`, `faction_id smallint → factions`, `started_at timestamptz not null`, `ended_at timestamptz`, `finished_at timestamptz`, `status walk_status not null default 'active'`, `week_id text`, `distance_m real`, `duration_s int`, `steps int`, `path geography(LineString,4326)`, `path_simplified geography(LineString,4326)`, `sample_count int not null default 0`, `hex_count int not null default 0`, `flags jsonb not null default '[]'`, `device_id uuid → devices on delete set null` | pk `id`; unique `(user_id, client_walk_id)`; index `(user_id, started_at desc)`; gist `(path_simplified)`; partial index `(user_id) where status = 'active'`; index `(week_id)` |
| `location_samples` | `walk_id uuid not null → walk_sessions on delete cascade`, `seq int not null`, `ts timestamptz not null`, `lat double precision not null`, `lon double precision not null`, `h_acc real not null`, `speed real`, `course real`, `alt real`, `accepted boolean not null default true`, `reject_reason text` | **`PARTITION BY RANGE (ts)`**; pk `(walk_id, seq, ts)` — `ts` is added to §6's `pk(walk_id, seq)` because Postgres requires the partition key in every unique constraint; monthly partitions `location_samples_yYYYYmMM` created by `ensure_location_samples_partition(date)` (`0001_partitions.sql`), plus `location_samples_default`; index `(ts)` for the 30-day purge |
| `walk_hex_meters` | `walk_id uuid → walk_sessions on delete cascade`, `h3_r9 bigint not null`, `meters real not null` | pk `(walk_id, h3_r9)`; index `(h3_r9)` |

### 4.4 Territory [`schema/hexes.ts`]

| Table | Columns | Keys / indexes |
|---|---|---|
| `hex_week_contribution` | `h3_r9 bigint`, `week_id text`, `faction_id smallint → factions`, `user_id uuid → users`, `meters real not null default 0`, `capped_meters real not null default 0`, `capture_bonus_m real not null default 0`, `walks int not null default 0`, `updated_at timestamptz not null default now()` | pk `(h3_r9, week_id, faction_id, user_id)`; index `(week_id, h3_r9)`; index `(user_id, week_id)` |
| `hex_faction_strength` | `h3_r9 bigint`, `faction_id smallint → factions`, `strength real not null default 0`, `last_reckoned_week text` | pk `(h3_r9, faction_id)` |
| `hex_state` | `h3_r9 bigint`, `h3_r8 bigint not null`, `h3_r7 bigint not null`, `h3_r6 bigint not null`, `h3_r5 bigint not null`, `geom geometry(Polygon,4326) not null`, `owner_faction_id smallint → factions`, `owner_since_week text`, `captain_user_id uuid → users on delete set null`, `last_reckoned_week text`, `last_activity_week text`, `version int not null default 0` | pk `h3_r9`; btree on each of `h3_r8`, `h3_r7`, `h3_r6`, `h3_r5`; gist `(geom)`; index `(owner_faction_id)`. Written only by `reckoning.weekly` (Constitution II) |
| `hex_ownership_events` | `id bigserial`, `h3_r9 bigint not null`, `week_id text not null`, `from_faction smallint`, `to_faction smallint`, `cause text not null`, `at timestamptz not null default now()` | pk `id`; index `(h3_r9, at desc)`; index `(week_id)` |
| `hex_parent_state` | `h3 bigint`, `res smallint not null`, `geom geometry(Polygon,4326) not null`, `owner_faction_id smallint → factions`, `child_owner_counts jsonb not null default '{}'`, `claimed_children int not null default 0`, `updated_at timestamptz not null default now()` | pk `h3`; index `(res)`; gist `(geom)`; index `(owner_faction_id)` |
| `reckonings` | `week_id text`, `started_at timestamptz not null default now()`, `finished_at timestamptz`, `hexes_processed int not null default 0`, `flips int not null default 0`, `status reckoning_status not null default 'running'` | pk `week_id` |

### 4.5 Species and captures [`schema/species.ts`, `schema/captures.ts`]

| Table | Columns | Keys / indexes |
|---|---|---|
| `species` | `id serial`, `kingdom kingdom not null`, `scientific_name text not null`, `common_name_en text`, `common_name_lt text`, `family text`, `gbif_key int`, `birdnet_label text`, `plantnet_id text`, `region_lt boolean not null default false`, `rarity_tier smallint not null default 1`, `image_url text`, `image_license text`, `image_attribution text`, `is_active boolean not null default true` | pk `id`; unique `scientific_name`, `gbif_key`, `birdnet_label`; index `(kingdom, region_lt)` |
| `species_season` | `species_id int → species on delete cascade`, `week smallint not null`, `present boolean not null` | pk `(species_id, week)`; check `week between 1 and 53` |
| `captures` | `id uuid`, `user_id uuid → users`, `client_capture_id uuid not null`, `walk_id uuid → walk_sessions on delete set null`, `kind kingdom not null`, `faction_id smallint → factions`, `h3_r9 bigint not null`, `week_id text not null`, `lat double precision not null`, `lon double precision not null`, `captured_at timestamptz not null`, `media_key text`, `media_type text`, `media_bytes int`, `device_model_version text`, `device_species_id int → species`, `device_confidence real`, `cloud_provider text`, `cloud_model_version text`, `cloud_species_id int → species`, `cloud_confidence real`, `cloud_raw jsonb`, `final_species_id int → species`, `status capture_status not null default 'created'`, `bonus_m real not null default 0`, `verified_at timestamptz`, `created_at` | pk `id`; unique `(user_id, client_capture_id)`; index `(user_id, created_at desc)`; index `(h3_r9)`; partial index `(status, created_at) where status in ('uploaded','verifying')` (verification queue) |
| `capture_candidates` | `capture_id uuid → captures on delete cascade`, `source candidate_source not null`, `rank smallint not null`, `species_id int → species`, `raw_label text not null`, `confidence real not null` | pk `(capture_id, source, rank)` |
| `user_species` | `user_id uuid → users on delete cascade`, `species_id int → species`, `first_capture_id uuid → captures on delete set null`, `first_seen_at timestamptz not null default now()`, `capture_count int not null default 1` | pk `(user_id, species_id)` |

### 4.6 Game layer and operations [`schema/game.ts`, `schema/ops.ts`]

| Table | Columns | Keys / indexes |
|---|---|---|
| `points_ledger` | `id bigserial`, `user_id uuid → users`, `faction_id smallint → factions`, `kind ledger_kind not null`, `points int not null`, `ref_type text`, `ref_id text`, `h3_r9 bigint`, `week_id text`, `created_at` | pk `id`; index `(user_id, created_at desc)`; index `(week_id, faction_id)`; index `(h3_r9)` |
| `streaks` | `user_id uuid → users on delete cascade`, `current_days int not null default 0`, `longest_days int not null default 0`, `last_active_date date`, `tz text not null default 'Europe/Vilnius'` | pk `user_id` |
| `leaderboard_snapshots` | `week_id text`, `scope text not null` (`global` \| `faction` \| `hex_r7`), `scope_id text not null default ''`, `rank int not null`, `user_id uuid → users`, `meters real not null default 0`, `points int not null default 0`, `computed_at timestamptz not null default now()` | pk `(week_id, scope, scope_id, rank)`; index `(user_id, week_id)` |
| `faction_stats_weekly` | `week_id text`, `faction_id smallint → factions`, `hexes_owned_r9 int not null default 0`, `hexes_owned_r7 int not null default 0`, `meters real not null default 0`, `active_users int not null default 0`, `captures int not null default 0` | pk `(week_id, faction_id)` |
| `anti_cheat_flags` | `id bigserial`, `user_id uuid → users`, `walk_id uuid → walk_sessions on delete set null`, `capture_id uuid → captures on delete set null`, `code text not null`, `details jsonb not null default '{}'`, `created_at`, `resolved_at timestamptz`, `resolution text` | pk `id`; index `(user_id)`; partial index `(created_at) where resolved_at is null` |

### 4.7 Migration files

| File | Content |
|---|---|
| `drizzle/0000_init.sql` | generated by `drizzle-kit generate`, then hand-edited: extension header prepended; `location_samples` DDL replaced with the partitioned form and pk `(walk_id, seq, ts)` |
| `drizzle/0001_partitions.sql` | `location_samples_default`; `ensure_location_samples_partition(month date) returns void`; calls for `date_trunc('month', now())` and `+ 1 month` |
| `drizzle/0002_seed_factions.sql` | the three faction rows (`on conflict (id) do nothing`) |
| `drizzle/meta/` | Drizzle Kit journal; `drizzle.config.ts` sets `tablesFilter: ['!location_samples*']` so later diffs leave the partitioned table alone |

Integration test (`apps/api/test/integration/schema.test.ts`) asserts: every table name in §4.2–4.6 exists; `location_samples` has `partstrat = 'r'`; inserting a faction (id 9), a user and a `hex_state` row (with parents and a `geom` built via `ST_GeomFromText`) succeeds and the row round-trips through Drizzle; `SELECT postgis_version()` works; `h3` extension presence is reported but not required.
