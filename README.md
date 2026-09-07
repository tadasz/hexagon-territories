# Nature Explorer

A native iOS game for nature explorers: **conquer H3 hexagons by walking, capture birds by sound, capture plants by photo.** Players belong to factions; the metres they walk inside each hexagon are tallied at the end of every walk, and once a week a reckoning decays old strength and decides which faction owns each hexagon.

This repository started as a Leaflet + h3-js web prototype (now in `prototype/index.html`). It is being rebuilt as a SwiftUI app with a TypeScript API on Postgres.

## Documents

| Document | What it is |
|---|---|
| `docs/mvp.md` | What the MVP is and how we measure it |
| `docs/architecture.md` | Stack, monorepo layout, iOS/app/backend design, data model, recognition pipelines |
| `docs/territory-rules.md` | Tunable game rules: metres per hex, caps, weekly decay, ownership, parents |
| `docs/roadmap.md` | Phases, feature backlog (Spec Kit feature numbers), effort and exit criteria |
| `docs/adr/` | Architecture decision records |
| `.specify/memory/constitution.md` | Binding principles every feature must satisfy |
| `specs/NNN-name/` | Spec Kit feature directories (spec → plan → tasks) |

## Development process (Spec Kit)

Every feature is driven through the Spec Kit loop with Claude Code:

```
/speckit-specify   → specs/NNN-name/spec.md
/speckit-clarify   → resolve open questions
/speckit-plan      → plan.md, research.md, data-model.md, contracts/, quickstart.md
/speckit-tasks     → tasks.md
/speckit-analyze   → consistency check
/speckit-implement → code
/speckit-converge  → repeat until "Converged"
```

Feature numbers and short names are fixed in `docs/roadmap.md`; create a new feature with

```
.specify/scripts/bash/create-new-feature.sh --number 2 --short-name auth-and-factions "Sign in with Apple, faction pick, profile"
```

## Planned layout

```
apps/ios        SwiftUI app (XcodeGen + local Swift packages)
apps/api        Fastify + TypeScript + Drizzle + pg-boss
apps/ml-worker  Python BirdNET verification service
packages/       territory-rules, h3-fixtures, api-schema, walk-sim
ml/             model manifest, eval sets
infra/          docker-compose, Postgres image, Caddy
docs/           architecture, rules, roadmap, ADRs
specs/          Spec Kit features
prototype/      original web prototype (reference only)
```

Feature `001-repo-foundations` creates this layout.
