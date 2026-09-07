# Nature Explorer — guide for coding agents

This repository is developed with **GitHub Spec Kit**. Before touching code:

1. Read `.specify/memory/constitution.md` (binding principles) and `docs/architecture.md` (the agreed stack and system design).
2. Find the feature you are working on under `specs/NNN-name/`. Work only inside its `tasks.md`; if the feature has no `plan.md` or `tasks.md` yet, run `/speckit-plan` and `/speckit-tasks` first.
3. Territory scoring and ownership rules are defined in `docs/territory-rules.md`. Change the shared fixtures in `packages/h3-fixtures` first, then the TypeScript rules, then the Swift port.
4. Never add a model, dataset, tile source or species image without a licence entry (`ml/models/manifest.json` or `docs/licences.md`).
5. Finish every feature with `/speckit-analyze` and `/speckit-converge`.

Spec Kit skills installed for Claude Code: `/speckit-constitution`, `/speckit-specify`, `/speckit-clarify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-analyze`, `/speckit-checklist`, `/speckit-implement`, `/speckit-converge`, `/speckit-taskstoissues`.

To point Spec Kit at a feature without switching branches: `export SPECIFY_FEATURE=001-repo-foundations`.

Roadmap and feature backlog: `docs/roadmap.md`. MVP scope: `docs/mvp.md`. Decisions: `docs/adr/`.

The original web prototype lives in `prototype/index.html` (Leaflet + h3-js); it is reference only and is not built or deployed.
