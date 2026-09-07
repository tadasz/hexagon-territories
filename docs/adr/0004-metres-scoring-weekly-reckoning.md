# ADR 0004: Metres-walked scoring at walk finish, weekly reckoning for ownership

**Status**: accepted · **Date**: 2026-09-07

## Context
The prototype randomised ownership and aggregated parents from children on the client. The product owner decided: walk paths are recorded and drawn; a hex's contribution is the metres walked inside it; points are calculated only when a walk finishes; ownership decays and is decided once per week.

## Decision
- `finishWalk` (server) simplifies the accepted path, clips it to res-9 cells and credits metres per cell to the player's faction for the ISO week (Europe/Vilnius), with a weekly per-player-per-cell cap.
- `reckoning.weekly` (Monday 00:00 local) halves every faction's strength, adds the week's capped metres and capture bonuses, and decides owners with a minimum strength and 10 % hysteresis. It is the only code path that changes ownership. Parents are derived from child ownership.
- Between reckonings the map shows a contested indicator computed from a read model; owners do not change.

Full rules: `docs/territory-rules.md`.

## Consequences
- Simple, explainable, cheap: no live scoring, one heavy job per week that is idempotent and resumable.
- Engagement relies on the contested indicator, weekly leaderboards and the Monday results push.
- The client shows only estimates during a walk.

## Alternatives
Continuous scoring with per-visit points and lazy exponential decay (more "live", far more edge cases and anti-cheat surface).
