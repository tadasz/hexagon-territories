<!--
Sync Impact Report
- Version change: 1.0.0 → 1.1.0 (MINOR: Principle III materially expanded — build-type scope
  for non-commercial weights and the monetisation gate)
- Modified principles: III. Licence Before Ship (NON-NEGOTIABLE) → same title; "never bundled in
  a release build" replaced by "allowed in Debug/TestFlight while non-commercial, forbidden in
  App Store builds, removed or licensed before monetisation"; `allowed_builds` manifest field
- Added sections: none
- Removed sections: none
- Reason recorded in: docs/adr/0011-noncommercial-prototype-models.md
- Templates/docs checked: docs/adr/0006 (addendum), docs/licences.md, docs/architecture.md §7,
  docs/roadmap.md (009 exit criterion), ml/models/manifest.json (`allowed_builds`),
  ml/tests/test_manifest.py, ml/models/README.md, specs/001-repo-foundations/data-model.md §3,
  CLAUDE.md (no change needed)
- Follow-up TODOs: none
-->
# Nature Explorer Constitution

Nature Explorer is a native iOS game in which players conquer H3 hexagons for their faction by walking, and capture birds (by sound) and plants (by photo). This constitution binds every feature specification, plan, task list and pull request in this repository. Where it conflicts with a template, a skill prompt, or a convenience, the constitution wins.

## Core Principles

### I. Server-Authoritative Game State
All scoring and ownership is computed by the API from data it has validated itself. The iOS app may estimate (metres in a hex, likely bird species) for immediate feedback, but every estimate is labelled provisional in the UI and replaced by the server's answer. No client-reported total is ever trusted; the server recomputes from raw samples and media.

### II. One Place for Each Rule
Territory rules (path → metres per hex, caps, weekly decay, ownership, parent aggregation, zoom → resolution) live in `packages/territory-rules` (TypeScript) and are mirrored in the Swift package `TerritoryRules`. Both implementations MUST pass the shared JSON fixtures in `packages/h3-fixtures`. A rule change is made in this order: fixtures → TypeScript → Swift → `docs/territory-rules.md`. Metres are scored only in `finishWalk`; ownership changes only in the `reckoning.weekly` job. No other code path writes `hex_state.owner_faction_id`.

### III. Licence Before Ship (NON-NEGOTIABLE)
Every ML model, dataset, map tile source, audio reference and species image has an entry with licence and attribution in `ml/models/manifest.json` or `docs/licences.md` before it is referenced by code. Non-commercial weights (for example BirdNET V2.4, CC BY-NC-SA 4.0) MAY be bundled in Debug and TestFlight builds **only while the product is non-commercial** — no revenue of any kind: no subscription, no ads, no paid features, no sponsorship. They are FORBIDDEN in App Store builds and MUST be removed or licensed before any monetisation. Each manifest entry declares `allowed_builds`; a non-commercial model never lists `appstore` and never carries a `primary-*` role. BirdNET+ V3 (Apache 2.0) remains the primary model in every build, so removing a non-commercial fallback never changes the product. Required attribution (Pl@ntNet, BirdNET, OpenStreetMap, Xeno-canto, Wikimedia) is rendered in the app.

### IV. Privacy by Default
Walk paths and location samples are the player's own data: private by default, never shown to other players in raw form. Raw location samples are retained at most 30 days; hex-level aggregates are the long-term record. Analytics (PostHog EU) never receive finer than an H3 resolution-7 cell. Account deletion and data export MUST keep working in every release. Infrastructure and analytics stay in the EU.

### V. Test at the Layer You Touch
Rules packages ship unit tests driven by fixtures. API modules ship integration tests against the real Postgres image (Testcontainers). iOS packages ship XCTest unit tests; user flows get XCUITests. Every feature directory ships a `quickstart.md` that a reviewer or agent can execute. Nothing merges with a red Xcode Cloud (iOS) or GitHub Actions (API, packages) run.

### VI. Small, Mergeable Steps
`tasks.md` items are independently mergeable and each maps to one pull request. Feature branches are named `NNN-short-name` and merge back into the integration branch by pull request. Do not widen a task; open a new task instead. Prefer boring, well-documented libraries over clever code.

### VII. Battery and Offline Are Features
Walk tracking, bird listening and capture MUST work with no connectivity, queueing work in the local outbox. Background location runs only during an explicit, foreground-started walk session (When-In-Use authorisation, never "Always"). Battery budget during a walk is under 6 % per hour on an iPhone 13; a change that breaks the budget is a regression.

## Technology Constraints

- iOS 17+, Swift 6, SwiftUI, MVVM with `@Observable`, local Swift packages, XcodeGen; GRDB for local persistence; MapLibre Native for maps; ONNX Runtime (Core ML execution provider) for on-device audio models.
- API: Node 22, TypeScript, Fastify 5, TypeBox schemas generating OpenAPI, Drizzle ORM, pg-boss jobs; Postgres 16 with PostGIS (h3-pg optional; H3 cells stored as `bigint` with precomputed parents so the schema never depends on the extension).
- Storage: S3-compatible object storage (Hetzner Object Storage in production, MinIO locally) accessed through presigned URLs; media never passes through the API.
- Analytics and crash reporting: PostHog EU Cloud. CI/CD: Xcode Cloud for iOS, GitHub Actions for everything else.
- Bird recognition: BirdNET+ V3 (Apache 2.0 weights) plus the BirdNET Geomodel on device, server-side verification in a Python worker. Plant recognition: Pl@ntNet API (cloud) in the MVP. Models are pinned by version and hash in `ml/models/manifest.json` and hidden behind protocols so they can be swapped.
- The full stack and rationale live in `docs/architecture.md`; decisions in `docs/adr/`.

## Development Workflow

- Every feature follows the Spec Kit loop: `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement` → `/speckit-converge` until Converged. Feature numbers and names come from `docs/roadmap.md`.
- `plan.md` MUST reference `docs/architecture.md` and `docs/territory-rules.md` rather than restating them, and MUST list any deviation with a justification.
- API contracts are written as OpenAPI fragments in `specs/NNN-name/contracts/` and merged into `packages/api-schema`; the iOS client is generated, never hand-written.
- Tunable game constants are changed only through `docs/territory-rules.md` and `packages/territory-rules/src/config.ts` together.
- A pull request description states which task it implements, how it was verified, and any constitution principle it touches.

## Governance

This constitution supersedes all other practices in the repository. Amendments are made by pull request that updates this file, bumps the version below, and records the reason in a new ADR under `docs/adr/`. Reviewers (human or agent) verify compliance with Principles I–VII on every pull request; any added complexity must be justified in the pull request against Principle VI. `CLAUDE.md` gives agents runtime guidance and must stay consistent with this document.

**Version**: 1.1.0 | **Ratified**: 2026-09-07 | **Last Amended**: 2026-09-07
