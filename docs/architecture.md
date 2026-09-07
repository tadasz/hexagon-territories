# Architecture

The agreed system design for Nature Explorer. Spec Kit `plan.md` files reference this document instead of restating it; deviations must be listed and justified in the plan. Game mechanics are in `territory-rules.md`; decisions and their alternatives are in `adr/`.

## 1. Product shape

- Native iOS app (SwiftUI). Android follows the App Store release as a new feature series that reuses the API and the TypeScript territory rules (`docs/roadmap.md`, post-launch).
- Three nature-themed factions: **Owls** 🦉 green (`#4CAF50` / `#2E7D32`), **Foxes** 🦊 amber (`#FFC107` / `#FFA000`), **Deer** 🦌 blue (`#2196F3` / `#1976D2`). Names, emoji and colours live in the `factions` seed (`specs/001-repo-foundations/data-model.md` §4.2), so renaming is a data change; `prototype/index.html` still shows the older placeholder names. Balance in the MVP: at sign-up the app pre-selects the faction with the fewest active players; there is no underdog multiplier.
- Territory: H3 resolution-9 cells scored by metres walked inside them at walk finish; ownership decided and decayed once per week by a reckoning job.
- Captures: birds by sound (on-device first, cloud verification), plants by photo (cloud first).
- Play area: anywhere in the world — hexes are scored wherever the player walks. Beta market: Lithuania (Kaunas); it is a test market, not a boundary.

## 2. Stack

| Layer | Choice | Rationale (alternative in italics) |
|---|---|---|
| iOS app | Swift 6, SwiftUI, iOS 17+, MVVM with `@Observable`, feature modules as local Swift packages | Shippable by a small team; package boundaries give isolated tests. *TCA.* |
| Project generation | XcodeGen (`project.yml`) + local SPM packages | No `.pbxproj` merge conflicts. *Tuist.* |
| Maps | MapLibre Native iOS wrapped in our own `UIViewRepresentable`; hosted global vector tiles from OpenFreeMap (OpenStreetMap data, free, no API key; styles `liberty` / `bright` for light/dark) | GPU rendering of 5k+ hex polygons, data-driven faction colours, line layers for walk paths; a worldwide play area needs a global basemap, not a country extract. *MapKit rejected: no data-driven styling, `MKMultiPolygon` is UIKit-only. Self-hosting a Protomaps PMTiles extract in our bucket remains a later option (ADR 0003 addendum).* |
| H3 on iOS | Vendored Uber H3 C core as an SPM C target with a thin Swift wrapper (`H3Kit`) | Same indexes as the server; no official Swift binding exists. |
| Local persistence | GRDB (SQLite) | Offline outbox and background bulk writes. *SwiftData.* |
| Location | Core Location `CLLocationUpdate.liveUpdates(.fitness)` + `CLBackgroundActivitySession` during walks; `CMPedometer` as a plausibility signal | When-In-Use authorisation only; foreground-started sessions. |
| ML on device | ONNX Runtime (Core ML execution provider) for BirdNET+ V3 + Geomodel; Core ML for the later plant classifier | Matches the shipped artefact format. *LiteRT for TFLite models.* |
| ML server | Python worker running BirdNET FP32 + Geomodel for verification; Pl@ntNet API for plants | Only supported server path for BirdNET. |
| API | Node 22, TypeScript, Fastify 5, TypeBox schemas → OpenAPI, Drizzle ORM, pg-boss jobs | Schema-first feeds `swift-openapi-generator`; Postgres-backed jobs, no Redis. *Go + h3-go + sqlc.* |
| Database | Postgres 16 + PostGIS 3.4 (+ h3-pg where available) | Path clipping (`ST_Intersection`, `ST_Length`), MVT, bbox queries. |
| Object storage | Hetzner Object Storage (S3-compatible) via presigned URLs; MinIO locally | Clips (~50 KB), photos (~300 KB); media never passes through the API. A self-hosted PMTiles basemap would live here too if we ever switch away from OpenFreeMap. *Cloudflare R2 if egress grows.* |
| Hosting | Hetzner VPS (Helsinki) + Docker Compose (api, worker, postgres, caddy) | EU residency, one vendor. *Fly.io + Neon.* |
| Auth | Sign in with Apple → Apple JWKS verification → JWT access (15 min) + rotating refresh token in Keychain | App Store requirement; no passwords. |
| Push | APNs token auth | Reckoning results, hex lost, verification results, streaks. |
| Analytics / crash | PostHog EU Cloud (analytics, feature flags, iOS error tracking); `posthog-node` on the API | One vendor. Events carry at most a res-7 cell. Xcode Organizer crash reports remain the baseline while PostHog iOS error tracking is experimental. |
| CI/CD | Xcode Cloud for iOS (PR: build + unit tests; merge: tests + TestFlight internal; tag: TestFlight external / App Store); GitHub Actions for API and packages | Xcode Cloud cannot run Node/Postgres jobs. 25 free compute hours/month: keep PR workflows to unit tests, run XCUITests nightly. |

Why TypeScript for the API: the logic that must match on client and server is H3 territory maths; `h3-js` v4 is the same library family as the prototype, and one shared `packages/territory-rules` package is tested against the fixtures the Swift port also runs. Heavy compute lives in Postgres and the Python worker, so Go's CPU advantage buys nothing at launch scale.

## 3. Monorepo layout

```
.specify/                              Spec Kit memory, templates, scripts
.claude/skills/speckit-*/              Spec Kit skills for Claude Code
specs/NNN-name/                        one directory per feature
apps/
  ios/
    project.yml                        XcodeGen
    NatureExplorer/                    app target: App.swift, RootView, AppContainer (DI)
    Packages/
      H3Kit/ TerritoryRules/ APIClient/ Persistence/ DesignSystem/
      Location/                        WalkTracker, PathRecorder, HexMetersEstimator, PedometerBridge
      Audio/ Camera/
      MapFeature/                      MapLibre wrapper, HexOverlayController, WalkPathsLayer
      WalkFeature/ CaptureBirdFeature/ CapturePlantFeature/ CollectionFeature/
      FactionsFeature/ ProfileFeature/ AuthFeature/
    Resources/Models/                  .onnx (git-lfs)
    ci_scripts/ci_post_clone.sh        Xcode Cloud: install XcodeGen, generate project, pull LFS
    Tests/
  api/                                 Fastify + Drizzle + pg-boss (src/{modules,jobs,plugins,db}, drizzle/, test/)
  ml-worker/                           Python BirdNET verification service
packages/
  territory-rules/                     TS: config, pathToHexMeters, caps, decay, ownership, parents, zoom→res
  h3-fixtures/                         JSON fixtures shared by TS and Swift tests
  api-schema/                          OpenAPI 3.1 (generated), enums, species seed
  walk-sim/                            GPX → batched ingest replay CLI, reckoning trigger, k6 wrapper
ml/{models/manifest.json, eval/, plant-classifier/}
infra/{docker-compose.yml, docker/postgres/Dockerfile, caddy/Caddyfile}
prototype/index.html                   original web prototype (reference only)
docs/{architecture.md, territory-rules.md, mvp.md, roadmap.md, licences.md, adr/, privacy/}
.github/workflows/{api.yml, ml-eval.yml}
```

Tooling: pnpm workspaces + turborepo for `apps/api` and `packages/*`; Drizzle Kit migrations; `swift-openapi-generator` build plugin; git-lfs for `.onnx`; `mise`/`.tool-versions` pin Node and Python; `make dev` brings up Docker Compose.

## 4. iOS app

**Pattern**: SwiftUI views → `@Observable` view models → protocol-typed services from `AppContainer`. Feature packages depend only on core packages. Tabs: Map · Walk · Capture · Collection · Factions · Profile.

**Networking**: generated OpenAPI client; JWT middleware with refresh; media uploads straight to the bucket via presigned PUT.

**Persistence (GRDB)**: `walk`, `location_sample` (queued), `walk_path` (simplified polyline for display), `capture`, `species`, `user_species`, `hex_cache` (owner + weekly pressure, fetched_at), `outbox`. A `SyncCoordinator` actor drains the outbox with backoff and resumes on `NWPathMonitor` and `BGAppRefreshTask`.

### Walk tracking and path recording
1. "Start walk" (foreground) creates a `CLBackgroundActivitySession` and starts `liveUpdates(.fitness)`; `UIBackgroundModes = [location, audio]`; `CMPedometer` starts.
2. Device filter mirrors the server's (`territory-rules.md`); keep ~1 sample per 5 s or ≥ 10 m moved.
3. Accepted samples append to the walk polyline, drawn live by `WalkPathsLayer`. `HexMetersEstimator` splits each new segment at res-9 boundaries and accumulates estimated metres per hex for the HUD. This is an estimate; nothing is scored until finish.
4. Samples upload in batches (≤ 200, every 60 s), idempotent by `(walkId, seq)`; the server stores them without scoring.
5. Finish → `POST /v1/walks/{id}/finish` → the server computes authoritative metres per hex and returns the summary (path, distance, per-hex metres, this week's standing per hex, captures). Offline finish is queued; walks not finished within 12 h are auto-finished server-side.
6. Auto-pause when stationary > 3 min; auto-end after 6 h. Battery target < 6 % per hour.

### Bird capture
`AVAudioSession(.record, .measurement)` → `AVAudioEngine` tap → `AVAudioConverter` to mono Float32 at the manifest's sample rate (32 kHz for V3) → ring buffer → 3 s windows with 1.5 s hop → `BirdClassifier` (ONNX Runtime, Core ML EP, warmed on screen open) → sigmoid scores gated by the Geomodel presence vector (computed per session, cached per res-7 cell and week) → per-window top-5 ≥ 0.25 → `ListeningSession` aggregator (max confidence, hit count, best window). Proposal rule: max ≥ 0.65, or ≥ 0.50 in two windows. The best 6 s is saved as AAC for verification. `BirdClassifier` is a protocol so BirdNET V2.4 or Perch can be swapped in. Listening is capped at 15 minutes per session.

### Plant capture
Viewfinder or `PhotosPicker`, organ chips (leaf/flower/fruit/bark) → 1280 px JPEG with EXIF stripped except orientation → outbox → server returns top-3 → auto-accept or user confirmation. Feature 010 adds a Core ML preview classifier.

### Map
- `MapLibreView: UIViewRepresentable` around `MLNMapView`; style URL from `MapConfig` (OpenFreeMap `liberty` / `bright` for light/dark; hex border colour per style as in the prototype). Attribution "© OpenStreetMap contributors, © OpenFreeMap" is always visible.
- `HexOverlayController`: `MLNShapeSource` plus fill and line layers per resolution bucket (res 5–9); fill colour by owner faction, opacity 0.3; a hatched or pulsing outline when the cell is contested this week.
- On `regionDidChange` (debounced 150 ms): resolution from zoom (the prototype's table, now in `territory-rules`), `polygonToCells(viewport + 10 %)`, diff against `hex_cache`, fetch from `GET /v1/hexes`, build GeoJSON with `cellToBoundary`; cross-fade on resolution switch (1.2 s in, 0.6 s out). Tap flies to the cell one zoom level in; long-press opens the hex detail sheet. Client polyfill capped at 3 000 cells.
- `WalkPathsLayer`: the player's own recent walks (last 4 weeks) as a line layer coloured by faction, toggleable. Other players' raw paths are never shown; hex detail shows aggregated metres per faction instead.
- Feature 008 switches the overlay to `MLNVectorTileSource` on `/v1/tiles/hex/{z}/{x}/{y}.mvt`.

## 5. Backend

**Fastify modules**: `auth`, `users`, `factions`, `walks`, `territory` (reckoning, hex reads, tiles), `captures`, `species`, `collection`, `leaderboards`, `push`, `admin`. Rules are imported from `packages/territory-rules`.

**Jobs (pg-boss)**: `walk.autofinish` (hourly), `reckoning.weekly` (cron `0 0 * * 1` UTC — Monday 00:00 UTC, one global cutoff for all players; singleton, resumable per cell batch), `parent.recompute` (inside reckoning; nightly full re-derivation), `capture.verify` (retry 5×), `leaderboard.rollup` (after reckoning and every 10 min for live weekly boards), `samples.purge` (daily, > 30 days), `push.send`, `species_mask.refresh` (weekly).

**REST, JSON, `/v1`, OpenAPI generated**

```
POST /v1/auth/apple                  → tokens + user;   POST /v1/auth/refresh
DELETE /v1/me (30-day grace);         GET /v1/me/export
GET  /v1/factions;                    POST /v1/me/faction (once per 30 days)

POST /v1/walks                       {clientWalkId, startedAt, deviceInfo} → {walkId}
POST /v1/walks/{id}/samples          {samples:[{seq,ts,lat,lon,hAcc,speed,course,alt}], pedometer} → {accepted, rejected}
POST /v1/walks/{id}/finish           {endedAt, pedometerTotal} → {distanceM, durationS, path,
                                        hexes:[{h3, meters, cappedMeters, weekStanding:{leader, myFactionShare}}], xp, flags}
GET  /v1/walks?cursor=;               GET /v1/walks/{id}

GET  /v1/hexes?res=&bbox=            → [{h3, owner, ownerSince, pressureLeader, contested}]   (res 5–9, bbox capped per res)
GET  /v1/hexes/{h3}                  owner, strength per faction, this week's metres per faction, my metres, captain,
                                     recent captures, last 8 reckonings
GET  /v1/reckonings/latest           {weekId, ranAt, nextAt, factionTotals, myFlips}
GET  /v1/tiles/hex/{z}/{x}/{y}.mvt   (feature 008)

POST /v1/captures … /uploaded … /confirm;   GET /v1/captures/{id}
GET  /v1/species?kingdom=&region=<code>;     GET /v1/species/regional-mask?lat&lon&week
GET  /v1/me/collection;                      GET /v1/me/stats
GET  /v1/leaderboards?scope=global|faction|hex_r7&period=week|all&weekId=
POST /v1/devices
```

**`finishWalk`** (one transaction; the only place metres are scored) and **`reckoning.weekly`** (the only place ownership changes) are specified step by step in `territory-rules.md`. Verification outcomes for captures feed `hex_week_contribution` as bonus metres.

**Capture verification**: bird → Python worker (BirdNET FP32 + Geomodel); plant → Pl@ntNet. Results stored as `capture_candidates` and a final status; verified captures upsert `user_species`, award XP and add the bonus.

**Protection**: per-user token bucket on ingest (2 batches/min), 8 640 samples per day, overlapping-walk guard, daily walking-XP cap, App Attest on `POST /walks` and `POST /captures` from feature 008, simulator allowed only for the `tester` role, `anti_cheat_flags` audit table with admin clearing.

## 6. Data model (Postgres)

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS h3;  -- optional

CREATE TYPE kingdom AS ENUM ('bird','plant');
CREATE TYPE capture_status AS ENUM ('created','uploaded','verifying','verified','needs_user_confirm','rejected','failed');
CREATE TYPE ledger_kind AS ENUM ('walk_distance','capture_bird','capture_plant','first_species','hex_flip','streak','bonus','adjustment');

factions(id smallint pk, slug unique, name, emoji, color_light, color_dark, sort)
users(id uuid pk, apple_sub unique, email, display_name, faction_id fk, faction_changed_at, xp int, level smallint,
      role 'player|tester|admin', created_at, last_seen_at, deleted_at)
refresh_tokens(id uuid pk, user_id fk cascade, token_hash bytea unique, expires_at, revoked_at, device_id)
devices(id uuid pk, user_id fk cascade, apns_token unique, app_version, os_version, model, attested bool, updated_at)

walk_sessions(id uuid pk, user_id fk, client_walk_id uuid, faction_id, started_at, ended_at, finished_at,
      status 'active|finished|flagged|abandoned', week_id text, distance_m, duration_s, steps,
      path geography(LineString,4326), path_simplified geography(LineString,4326),
      sample_count, hex_count, flags jsonb, device_id, unique(user_id, client_walk_id))
location_samples(walk_id fk cascade, seq, ts, lat, lon, h_acc, speed, course, alt, accepted bool, reject_reason,
      pk(walk_id, seq)) PARTITION BY RANGE (ts)          -- 30-day retention
walk_hex_meters(walk_id fk cascade, h3_r9 bigint, meters real, pk(walk_id, h3_r9))

hex_week_contribution(h3_r9 bigint, week_id text, faction_id smallint, user_id uuid,
      meters real, capped_meters real, capture_bonus_m real default 0, walks int, updated_at,
      pk(h3_r9, week_id, faction_id, user_id))
hex_faction_strength(h3_r9 bigint, faction_id smallint, strength real, last_reckoned_week text, pk(h3_r9, faction_id))
hex_state(h3_r9 bigint pk, h3_r8, h3_r7, h3_r6, h3_r5 bigint, geom geometry(Polygon,4326),
      owner_faction_id fk null, owner_since_week text, captain_user_id, last_reckoned_week, last_activity_week, version int)
hex_ownership_events(id bigserial pk, h3_r9, week_id, from_faction, to_faction, cause, at)
hex_parent_state(h3 bigint pk, res smallint, geom, owner_faction_id, child_owner_counts jsonb, claimed_children int, updated_at)
reckonings(week_id text pk, started_at, finished_at, hexes_processed int, flips int, status)

species(id serial pk, kingdom, scientific_name unique, common_name_en, common_name_lt, family, gbif_key unique,
      birdnet_label unique, plantnet_id, rarity_tier smallint, image_url, image_license,
      image_attribution, is_active)
species_region(species_id fk, region_code text, pk(species_id, region_code))   -- per-region flag; 'lt' is the first seeded region
species_season(species_id fk, week smallint, present bool)

captures(id uuid pk, user_id fk, client_capture_id uuid, walk_id fk null, kind, faction_id, h3_r9, week_id, lat, lon,
      captured_at, media_key, media_type, media_bytes, device_model_version, device_species_id, device_confidence,
      cloud_provider, cloud_model_version, cloud_species_id, cloud_confidence, cloud_raw jsonb,
      final_species_id, status capture_status, bonus_m real, verified_at, created_at, unique(user_id, client_capture_id))
capture_candidates(capture_id fk cascade, source 'device|cloud', rank, species_id, raw_label, confidence, pk(capture_id, source, rank))
user_species(user_id fk cascade, species_id fk, first_capture_id, first_seen_at, capture_count, pk(user_id, species_id))

points_ledger(id bigserial pk, user_id, faction_id, kind ledger_kind, points, ref_type, ref_id, h3_r9, week_id, created_at)
streaks(user_id pk, current_days, longest_days, last_active_date, tz default 'UTC')   -- player's local zone, set from the device; streaks are the only local-time rule
leaderboard_snapshots(week_id, scope, scope_id, rank, user_id, meters real, points int, computed_at, pk(week_id, scope, scope_id, rank))
faction_stats_weekly(week_id, faction_id, hexes_owned_r9, hexes_owned_r7, meters, active_users, captures, pk(week_id, faction_id))
anti_cheat_flags(id bigserial pk, user_id, walk_id, capture_id, code, details jsonb, created_at, resolved_at, resolution)
```

Indexes: btree on every `h3_*` column and on `(user_id, created_at desc)` style access paths; GiST on `geom` and `path_simplified`; partial index on `captures(status)` for the verification queue. H3 cells are stored as `bigint` with parents precomputed in app code so rollups are index-only and the schema never depends on h3-pg. `geom` is stored so PostGIS clipping, bbox and MVT queries need no extension at read time.

## 7. Recognition pipelines

### Birds
- Primary model: BirdNET+ V3.0-preview3.1 Global 10K-pruned FP16 ONNX (Apache 2.0 as bundled in Cornell's BirdNET Live app) plus Geomodel 3.0.4 FP16 ONNX (Apache 2.0). `ml/models/manifest.json` records sample rate (32 kHz), window, labels, sha256 and licence.
- Fallbacks behind the same `BirdClassifier` protocol: BirdNET V2.4 TFLite (CC BY-NC-SA 4.0) may be bundled in **Debug and TestFlight builds only while the app is non-commercial** (Constitution III v1.1.0, ADR 0011) and is forbidden in App Store builds; it must be removed or licensed from Cornell before any monetisation — V3 stays primary in every build so nothing needs swapping. Tester (Debug/TestFlight) builds in feature 006 bundle both V3 and V2.4 behind `BirdClassifier` with a Debug-menu switch so testers can compare the two in the field; the App Store build bundles V3 + Geomodel only, enforced by the manifest's `allowed_builds` and the feature 009 release checklist. Google Perch v2 (Apache 2.0) is the evaluated fallback, with the classifier head sliced to the regions seeded in `species_region`.
- Regional filter: Geomodel presence for the player's actual (lat, lon, week) — global, no country boundary — dropping species below 0.03; the server applies the same Geomodel mask plus `species_region(species_id, region_code)`, a per-region flag table. `lt` is the first seeded region (~250 species from Geomodel over a Lithuania grid plus the eBird checklist); further regions are seeded as players appear.
- Verification thresholds (calibrated in feature 006): verified if server top-1 ≥ 0.50 and equals device top-1, or ≥ 0.70 within device top-3; needs user confirmation at 0.30–0.50 (reduced bonus); otherwise rejected. Offline captures stay queued and are shown as unconfirmed.
- The V3 preview is documented as subject to change: pin versions, re-check terms per release, show "Powered by BirdNET" attribution.

### Plants
- MVP is cloud-only via Pl@ntNet (`k-northern-europe` project first, then `all`; organ tags; 1–3 images). Species are mapped by GBIF key; unknowns are inserted inactive for review. Thresholds: ≥ 0.30 verified; 0.12–0.30 needs user confirmation; < 0.12 rejected with guidance. Free tier with attribution during development; Pro plan before public TestFlight.
- Feature 010 (post-launch): MobileNetV3 / EfficientNet-Lite on ~300 common Lithuanian taxa (GBIF CC-BY/CC0 images) as Core ML for live hints and provisional offline entries; the cloud remains the verifier. Species-level on-device identification across all Baltic flora is out of scope.

## 8. Cross-cutting concerns

- **Play area**: worldwide. Nothing in the rules, map or species pipeline is bounded to Lithuania; Kaunas is only where the beta is tested.
- **GDPR**: walk paths are precise location data and stay private to the player (only the player ever sees their own paths; other players and the map see aggregated metres per faction); DPIA recommended; 30-day raw retention; EU hosting including PostHog EU; export and deletion endpoints; analytics no finer than res-7; age gate 13+ (consider 16 for Lithuania).
- **App Store review**: background location and audio are user-initiated (visible walk session, blue indicator); reviewer notes and demo video; account deletion; privacy manifest.
- **Battery**: GPS plus audio inference is the worst case; listening cap, Core ML execution provider, GPS throttling; measured with `xctrace` Energy Log on three devices.
- **Cheating**: spoofers, phone-swing and bots are detected cheaply and excluded from the reckoning while flagged; perfect prevention is not a goal.
- **Weekly cadence**: one global cutoff — weeks are ISO weeks in UTC and the reckoning runs Monday 00:00 UTC for everyone; nothing flips mid-week; the contested indicator, live weekly leaderboards, per-walk "your share" feedback and the Monday results push (sent in the player's local morning) keep the loop alive.
