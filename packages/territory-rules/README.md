# @nature/territory-rules

Pure, side-effect-free TypeScript implementation of the territory rules in `docs/territory-rules.md`.
Imported by the API (`apps/api`) for `finishWalk` and `reckoning.weekly`; mirrored by the Swift
package `TerritoryRules` (`apps/ios/Packages/TerritoryRules`) for the client's provisional estimate.
Both must pass the fixtures in `@nature/h3-fixtures` (Constitution II).

**Changing a rule**: fixtures (`packages/h3-fixtures/scripts/generate.ts`, regenerate, hand-review)
→ this package (`src/config.ts` for constants) → Swift → `docs/territory-rules.md`. The constants
test fails if `config.ts` and the doc's "Constants summary" disagree.

## API

| Export | Signature | Semantics (`plan.md` "Shared Rule Semantics") |
|---|---|---|
| `RULES` | `as const` object | every key of the doc's "Constants summary" plus the walk-acceptance thresholds (`MAX_SAMPLE_HACC_M`, `MAX_SAMPLE_SPEED_MPS`, `TELEPORT_SPEED_MPS`, `MAX_WALK_MEDIAN_SPEED_MPS`, `MAX_WALK_DISTANCE_M`, `MAX_WALK_DURATION_S`, `MIN_STEPS_PER_M`, `NO_STEPS_MIN_DISTANCE_M`) |
| `resolutionForZoom(zoom)` | `number → number` | the prototype's table; non-integers floored, `< 0 → 1`, `> 18 → 9`; `NaN` throws |
| `acceptSamples(samples)` | `Sample[] → { accepted, rejected }` | sorted by `seq`; checks in order `non_monotonic` (vs the last *accepted* sample), `accuracy` (> 50 m), `speed` (> 5 m/s) |
| `walkFlags(accepted, pedometerSteps?)` | `Sample[] → WalkFlag[]` | over the raw accepted samples; `teleport`, `speed` (median), `distance` (> 30 km or > 6 h), `no_steps` (only with steps, > 500 m); table order |
| `simplifyPath(points, toleranceM = 5)` | `LatLng[] → LatLng[]` | Douglas–Peucker, point-to-segment distance in a local equirectangular frame (`projectLocal`), keep when strictly > tolerance, endpoints kept |
| `pathToHexMeters(points, { resolution = 9 })` | `LatLng[] → HexMeters[]` | split every segment at every cell boundary by bisection (bracket ≤ 0.05 m, crossing = outer bracket point), sum per cell, drop < 0.01 m, sort by cell |
| `applyWeeklyCap(contributions)` | `Contribution[] → CappedContribution[]` | sum per `(cell, factionId, userId)`, `cappedMeters = min(sum, 2000)`; sorted by cell, faction, user |
| `reckonWeek(input)` | `ReckonInput → ReckonResult` | `strength' = strength × 0.5 + Σ capped + Σ bonus`; ownership table below; `event` only when `flipped`; `captain` |
| `deriveParentOwner(childOwners)` | `(number \| null)[] → number \| null` | ≥ 2 claimed children, unique leader, leader share > 40 % |
| `weekIdFor(date)` | `Date → "YYYY-Www"` | ISO week in UTC — one global cutoff at Monday 00:00 UTC |
| `haversineM`, `pathLengthM`, `interpolate`, `deltaLonDeg`, `normalizeLon`, `projectLocal`, `EARTH_RADIUS_M` | geo helpers | haversine on R = 6371008.8 m; longitudes normalised to (−180, 180] so antimeridian-spanning segments work; polar walks unsupported |

Types: `LatLng`, `Sample`, `RejectReason`, `RejectedSample`, `AcceptResult`, `WalkFlag`, `HexMeters`,
`Contribution`, `CappedContribution`, `FactionStrength`, `ReckonContribution`, `ReckonBonus`,
`ReckonInput`, `ReckonResult`, `OwnershipEvent`, `Rules`.

### Ownership decision in `reckonWeek`

All comparisons use the new strengths. Factions below 0.001 are dropped.

| Situation | Owner |
|---|---|
| no faction ≥ `MIN_STRENGTH_M` (500) | unclaimed (`null`) |
| exact tie at the top among factions ≥ 500 | incumbent if it is still ≥ 500, else unclaimed |
| no incumbent, or the incumbent leads | the leader |
| incumbent < 500 (it no longer holds the cell) | the leader; hysteresis does not apply |
| challenger ≥ incumbent × 1.10 | the challenger |
| otherwise | incumbent keeps |

`captain` = the owning faction's contributor with the most `cappedMeters` among contributions that
carry a `userId` (ties by `userId` ascending); bonuses do not count; `null` when unclaimed.

### `finishWalk` pipeline (feature 003 wires it to the API)

```ts
const { accepted, rejected } = acceptSamples(samples);
const flags = walkFlags(accepted, pedometerSteps);
const path = simplifyPath(accepted);                    // RULES.SIMPLIFY_TOLERANCE_M
const distanceM = pathLengthM(path);
const hexes = pathToHexMeters(path);                    // RULES.RES
const weekId = weekIdFor(finishedAtUtc);
```

## Tests

```bash
pnpm --filter @nature/territory-rules test     # or: cd packages/territory-rules && npx vitest run
pnpm --filter @nature/territory-rules build lint typecheck
```

`test/*.test.ts` replay the four fixtures (`latlng-to-cell` via `h3-js` inside the walk tests,
`zoom-resolution`, `walk-paths`, `reckoning-weeks`), assert the constants against
`docs/territory-rules.md`, and add unit cases for the edge rules (check order, strict thresholds,
three-cell segment, degenerate segments, antimeridian, hysteresis boundary, ISO-year boundaries).
`vitest.config.ts` aliases `@nature/h3-fixtures` to the sibling package's source so the suite runs
without building it first; the `types` in `tsconfig`/`build` still resolve the built package (turbo
builds dependencies first).
