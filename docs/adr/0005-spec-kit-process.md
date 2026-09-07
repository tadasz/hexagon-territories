# ADR 0005: GitHub Spec Kit as the development process

**Status**: accepted · **Date**: 2026-09-07

## Context
Coding agents will implement most features. They need a repeatable way to turn intent into specs, plans and task lists that can be checked for consistency.

## Decision
Use GitHub Spec Kit (`specify init --integration claude`). The constitution in `.specify/memory/constitution.md` binds every feature. Each feature in `docs/roadmap.md` gets a numbered `specs/NNN-name/` directory and runs `/speckit-specify` → `/speckit-clarify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement` → `/speckit-converge`. `docs/architecture.md` and `docs/territory-rules.md` are referenced from plans rather than restated.

## Consequences
- Feature numbers and short names are fixed up front so branches and directories match the roadmap.
- `.claude/skills/speckit-*` is committed; `.specify/feature.json` is machine-local and ignored.
- Agents working without branch switching set `SPECIFY_FEATURE`.
