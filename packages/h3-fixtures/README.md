# @nature/h3-fixtures

Shared JSON fixtures that both territory-rule implementations must pass: `@nature/territory-rules`
(TypeScript, `packages/territory-rules`) and the Swift package `TerritoryRules`
(`apps/ios/Packages/TerritoryRules`, with `H3Kit`). They are the executable half of Constitution II
("one place for each rule"): a rule change is made **fixtures → TypeScript → Swift →
`docs/territory-rules.md`**.

## Files

| Path | Content |
|---|---|
| `fixtures/<name>.json` | the four fixtures (committed, generated) |
| `schema/<name>.schema.json` | JSON Schema (draft-07) of each fixture, exported from `src/schema.ts` |
| `src/schema.ts` | TypeBox definitions (`additionalProperties: false` everywhere) and the TypeScript types |
| `src/load.ts` | `loadFixture(name, { dir? })` — reads, parses and validates; throws `FixtureError` naming the file and the first invalid JSON pointer |
| `scripts/generate.ts` | deterministic generator (mulberry32, seed `20260907`); see `scripts/README-generator.md` |
| `test/load.test.ts` | validates the committed files and the loader's error messages |

Package exports: `loadFixture`, `fixturePath`, `fixturesDir`, `defaultFixturesDir`, `FixtureError`,
`FIXTURE_SCHEMAS`, `FIXTURE_NAMES`, every TypeBox schema and the `Static` types (`WalkPathsFixture`,
`ReckoningWeeksFixture`, `Sample`, ...). Fixture files are also importable as
`@nature/h3-fixtures/fixtures/<name>.json`.

**Locating the files from Swift**: walk up from `#filePath` to the directory containing
`pnpm-workspace.yaml`, then read `packages/h3-fixtures/fixtures/<name>.json` (research.md R3). The
TypeScript loader honours `FIXTURES_DIR` (an absolute directory) so a malformed copy can be tested:
`echo '{' > /tmp/bad/walk-paths.json; FIXTURES_DIR=/tmp/bad pnpm --filter @nature/territory-rules test`
fails naming `/tmp/bad/walk-paths.json`.

## Envelope

Every file has the envelope of `data-model.md` §1.1:

```jsonc
{
  "name": "walk-paths",                        // == file name without .json
  "description": "…",                          // human summary; reckoning-weeks lists its case ids here
  "generator": "scripts/generate.ts#walkPaths", // function that produced it
  "version": 1,                                // bump when the shape (not the values) changes
  "seed": 20260907,
  "cases": [ { "id": "…", "input": { … }, "expected": { … } } ]   // reckoning-weeks: factions/weeks/cells/parentCases instead
}
```

Cells are H3 index strings (`^[0-9a-f]{15}$`), coordinates `{lat, lon}` in WGS84 degrees, timestamps
ISO 8601 with a `Z` suffix, `id`s unique per file (tests use them in their names), unknown properties
rejected.

## Fixture summary

### `latlng-to-cell.json` — 200 cases (`schema/latlng-to-cell.schema.json`)

`input: {lat, lon}` → `expected: {r9, parents: {r8, r7, r6, r5}, boundaryVertexCount}`. 180 seeded-random
points in the Lithuania bounding box (`lt-random-000` … `lt-random-179`) plus 20 hand-picked: Kaunas
town hall, Ąžuolynas park, Nemunas island, Kaunas castle, Vilnius cathedral, Klaipėda, Nida, a point
1 m inside a res-9 edge (`near-cell-edge-1m`, same cell as the town hall), the antimeridian on both
sides (`antimeridian-east/west`, lat 66), both poles (`±89.999`), the origin, a res-9 pentagon centre
(`pentagon-res9`, `89080000003ffff`) and six world cities (Sydney, Tokyo, Nairobi, Quito, Reykjavík,
Ushuaia). `boundaryVertexCount` is 6 for hexagons and **10** for the pentagon: at class III (odd)
resolutions H3 pentagons carry distortion vertices (`data-model.md` §1.2 said 5, which only holds at
even resolutions; the H3 C core and h3-js agree on 10).

### `zoom-resolution.json` — 23 cases (`schema/zoom-resolution.schema.json`)

`input: {zoom}` → `expected: {resolution}` for z = 0…18 (`z0` … `z18`) plus `z-1` → 1, `z18.7` → 9,
`z20` → 9, `z13.4` → 7.

### `walk-paths.json` — 6 cases (`schema/walk-paths.schema.json`)

`input: {resolution: 9, simplifyToleranceM: 5, pedometerSteps?, samples[]}` →
`expected: {acceptedSeqs, rejected[{seq, reason}], flags, distanceM, simplifiedPointCount, hexMeters[{cell, meters}]}`.
Pipeline under test: `acceptSamples` → `walkFlags` (over the raw accepted samples) → `simplifyPath`
(Douglas–Peucker, 5 m) → `distanceM` (haversine length of the simplified path) → `pathToHexMeters`
(sorted by cell ascending; tolerance ±0.5 m per cell; `distanceM` ±0.5 m; `simplifiedPointCount` exact).

### `reckoning-weeks.json` — 10 cells × 3 weeks + 8 parent cases (`schema/reckoning-weeks.schema.json`)

`cells[]`: `{id, description, cell, initial: {owner, strengths[]}, weeks[{weekId, contributions[], bonuses[], expected}]}`
with `expected: {capped[], strengths[] (±0.01, sorted by factionId), owner, flipped, event? {from, to}, captain}`.
The test applies `applyWeeklyCap` to the raw `contributions` (raw rows carry `userId`), compares
`capped`, then calls `reckonWeek` with the capped rows and `bonuses`. Week N+1's initial state is
week N's `expected` (`owner` + `strengths`); `event` is present only when `flipped`; `captain` is the
owning faction's top walker by capped metres (ties by `userId` ascending, `null` when unclaimed or
bonus-only). `parentCases[]`: `{id, input: {childOwners[]}, expected: {owner}}` for `deriveParentOwner`.

## Review log

Every expected value was produced by the reference implementation in `scripts/generate.ts` (which
does not import `@nature/territory-rules`) and then checked as described below. Reviewer: Stream A
agent, 2026-09-07, commit of feature `001-repo-foundations`.

### walk-paths

Cross-check method A: the package's pure-bisection `pathToHexMeters` (`packages/territory-rules`)
agrees with the generator's 0.05 m-stepping + 0.1 mm-bisection reference for all six cases (test
`test/path-to-hex.test.ts`, max deviation < 0.06 m). Method B (independent geometry): for the three
cases whose simplified path is a single segment, the segment was clipped against each cell's
`cellToBoundary` polygon (Cyrus–Beck in a local equirectangular frame) and the clipped lengths
compared with the fixture — every cell agrees within 0.01 m.

| Case | Checked by hand | How |
|---|---|---|
| `straight-line` | 116 samples, seq 20 rejected (`accuracy`, hAcc 80), flags `[]`, `distanceM` 1196.994, 2 simplified points, 7 cells summing to 1196.994 | Segment length from the first to the last accepted sample recomputed with the haversine formula = 1196.994 m. Sparse segment seq 50→51 (399 m, 285 s ⇒ 1.4 m/s, no teleport) split on its own yields 3 cells, i.e. two boundaries. Cell metres cross-checked by polygon clipping (method B, max diff 0.009 m). Pedometer 1500 steps / 1197 m = 1.25 steps/m ⇒ no `no_steps`. |
| `edge-hugging` | 31 samples, all accepted, flags `[]`, `distanceM` 192.087, 9 simplified points, cells `891f40d1b8bffff` 102.438 + `891f40d1b8fffff` 89.649 | The two cells are the ones sharing the first edge of `891f40d1b8bffff` (checked with `cellToBoundary`/`gridDisk`). Per 5 s the sample moves 5 m along and 4 m across ⇒ 6.40 m; 30 steps ⇒ 192.1 m ✓. DP keeps the 7 triangular-wave peaks (±8 m > 5 m) plus both endpoints = 9 ✓. Metres split roughly evenly (102/90) as expected for a wave centred on the edge with the first sample on the edge. |
| `loop-inside-one-cell` | 43 samples, flags `[]`, `distanceM` 244.79, 9 simplified points, exactly one cell `891f40dabb3ffff` with 244.79 m | 42-gon of radius 40 m: perimeter 42 × 2 × 40 × sin(π/42) = 251.2 m along the circle; the simplified 8-segment polygon (DP keeps 8 of the 42 vertices + the closing duplicate) is shorter, 244.79 m, and equals the single-cell credit ✓. Radius 40 m ≪ res-9 inradius (~150 m). |
| `noisy-zigzag` | 94 samples; rejected seq 10, 40 (`accuracy`), 60 (`speed` 5.5), 70 (`non_monotonic`, 8 s back); flags `[]`; `distanceM` 665.936; 29 simplified points; 4 cells summing to 665.94 | Nominal L is 600 m; ±6 m lateral jitter that survives DP (points > 5 m off the chord) adds ~11 %, so 666 m is plausible and all four cells lie along the L (checked visually with `cellToLatLng`). Reject reasons re-derived from the sample values by hand. |
| `teleport` | 73 samples, all accepted, flags `["teleport"]`, `distanceM` 897.002, 2 simplified points, 5 cells summing to 897.002 | 301 m + 400 m jump + 196 m = 897 m ✓ (43 + 30 samples at 7 m); implied speed of the jump 80 m/s > 8 ⇒ `teleport`; median implied speed 1.4 m/s ⇒ no `speed`. Cells cross-checked by polygon clipping (max diff 0.007 m). |
| `car-speed` | 41 samples without `speed`, all accepted, flags `["teleport","speed","no_steps"]`, `distanceM` 3000.002, 2 simplified points, 14 cells summing to 3000.002 | 40 × 75 m = 3000 m ✓; implied 15 m/s > 8 and median 15 > 3.5; 120 steps / 3000 m = 0.04 < 0.5 over > 500 m ⇒ `no_steps`; 3 km < 30 km and 200 s < 6 h ⇒ no `distance`. Cells cross-checked by polygon clipping (max diff 0.005 m); smallest cell 57.65 m (start latitude chosen so no corner is clipped by less than a few metres). |

### reckoning-weeks

Arithmetic re-done by hand per week (`strength' = strength × 0.5 + Σ capped + Σ bonus`,
`MIN_STRENGTH_M = 500`, `HYSTERESIS = 0.10`):

| Case | Table row (`docs/territory-rules.md`) | Hand check |
|---|---|---|
| `no-faction-reaches-min` | No faction reaches 500 → unclaimed | W35 300/400; W36 150+100 = 250, 200; W37 125, 100+250 = 350. Never ≥ 500, owner `null` all weeks, no events, captain `null`. |
| `first-claim` | No incumbent, one faction ≥ 500 → that faction | W35 800 → owner 1, event null→1; W36 400+200 = 600 keeps; W37 300+400 = 700 keeps. Captain u1 every week. |
| `challenger-beats-hysteresis` | Challenger ≥ incumbent × 1.10 → challenger | W35 1000 → 1; W36 f1 500+100 = 600, f2 700 ≥ 660 ⇒ 2 (event 1→2); W37 f1 300+200 = 500, f2 350: 500 ≥ 385 ⇒ 1 (event 2→1). |
| `hysteresis-holds` | Incumbent ≥ 500 and no challenger clears hysteresis → incumbent keeps | W35 u1 2600→2000 + u2 300 = 2300 (data-model example), f2 bonus 300 → owner 1; W36 f1 1150+100 = 1250, f2 150+1162.5 = 1312.5 = 1.05 × 1250 < 1375 ⇒ holds although f2 leads; W37 625 vs 656.25 < 687.5 ⇒ holds; captain `null` in W37 (no contributions). |
| `incumbent-decays-below-min-no-challenger` | Incumbent below 500 and no challenger ≥ 500 → unclaimed | W35 900 → 1; W36 450 vs 200 ⇒ `null` (event 1→null); W37 225, 100, bonus 100 ⇒ `null`, not flipped. |
| `exact-tie-incumbent-keeps` | Exact tie at the top → incumbent keeps | W35 600 → 1; W36 300+300 = 600 vs 600 ⇒ keeps; W37 300+300 vs 300+300 ⇒ keeps. |
| `exact-tie-no-incumbent` | Exact tie … if none, unclaimed | W35 700/700 ⇒ `null`; W36 350+350 each ⇒ `null`; W37 350+400 = 750 vs 350+350 = 700 ⇒ 1 (event null→1). |
| `cap-and-bonus` | cap 2000 per player, bonuses uncapped | W35 f1 min(2600,2000)+300 = 2300, f2 1000 → 1; W36 f1 1150, f2 500+2000+min(2500,2000)+200 = 4700 ≥ 1265 ⇒ 2; W37 f1 575+2000+50 = 2625, f2 2350: 2625 ≥ 2585 ⇒ 1. `capped` rows list 2000 for u1 (W35), u4 (W36), u1 (W37). |
| `incumbent-below-min-challenger-above-min` | gap in the table (pinned here) | W35 960 → 1; W36 480 (< 500) vs 520: an incumbent below MIN no longer holds, hysteresis does not apply ⇒ 2 (event 1→2); W37 240 vs 260+100 = 360 ⇒ `null` (event 2→null). |
| `bonus-only` | bonuses count toward strength; `≥ 500` inclusive | W35 300+200 = 500 ≥ 500 ⇒ owner 3, captain `null` (no walk metres); W36 250 ⇒ `null`; W37 125+300 = 425 ⇒ `null`. |

Parent cases: `[1,1,1,2,2,3,3,null]` → 3/7 = 42.9 % > 40 % ⇒ 1; `[1,1,2,2,null]` tie ⇒ null;
`[1,null,null]` one claimed ⇒ null; `[null,null]` ⇒ null; `[1,1,2,3,2]` tie (and 40 %) ⇒ null;
`[1×4,2×3,3×3]` 4/10 = 40 % exactly ⇒ null; `[2,2,null×5]` 2/2 ⇒ 2; `[3×7]` ⇒ 3.

### latlng-to-cell / zoom-resolution

`h3-js` 4.5.0 is the oracle; the hand-picked cells were spot-checked (`kaunas-town-hall` →
`891f40da99bffff`, its res-8 parent `881f40da99fffff`; the pentagon is in `getPentagons(9)`; both
antimeridian points fall in the same cell `890d9100ad7ffff`). The zoom table was copied from
`prototype/index.html` (`zoomToResolution`) and re-read line by line.

## Regenerating

```bash
pnpm --filter @nature/h3-fixtures generate     # writes fixtures/*.json and schema/*.schema.json
git diff --exit-code packages/h3-fixtures      # byte-identical: seeded PRNG, prettier-formatted output
pnpm --filter @nature/h3-fixtures test
```

The generator refuses to write a fixture that fails its own schema, and asserts the case designs
(straight-line ≥ 4 cells with a two-boundary sparse segment, edge-hugging touches exactly two cells,
loop stays in one cell, each case's flags). Regeneration takes about two seconds.

## Mutation test (SC-002)

```bash
# change one expected value, e.g. the first hexMeters entry of straight-line
sed -i 's/"meters": 250.7$/"meters": 251.7/' packages/h3-fixtures/fixtures/walk-paths.json
pnpm --filter @nature/territory-rules test     # fails: "walk-paths.json … straight-line … hexMeters"
git checkout packages/h3-fixtures/fixtures     # revert
```

Both suites must go red on the same edit (Swift: `swift test` in `apps/ios/Packages/TerritoryRules`).
