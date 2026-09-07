# Fixture generator notes

`generate.ts` is the single source of the committed fixtures. It is deterministic (mulberry32 seeded
with `20260907`; every random draw is consumed in a fixed order) and formats its output with the
repository's Prettier config, so running it twice yields byte-identical files. All geometry helpers
(haversine on R = 6371008.8 m, spherical `destination`, initial bearing, lat/lon `lerp`) and the
reference rule implementations live in the script itself; it never imports `@nature/territory-rules`.

## Reference implementations (what the expectations mean)

- **Acceptance** (`refAccept`): samples sorted by `seq`; in order `non_monotonic` (timestamp not
  strictly after the last *accepted* sample), `accuracy` (`hAcc > 50`), `speed` (`speed` present and
  `> 5`).
- **Flags** (`refFlags`): computed on the raw accepted samples; `teleport` if any implied speed > 8 m/s,
  `speed` if the median implied speed > 3.5 m/s, `distance` if length > 30 000 m or duration > 6 h,
  `no_steps` if steps are given, length > 500 m and steps/metre < 0.5. Order: teleport, speed,
  distance, no_steps.
- **Simplification** (`refSimplify`): Douglas–Peucker with point-to-segment distance in a local
  equirectangular frame (origin: bounding-box mid-latitude and the first point's longitude, x scaled by
  `cos(midLat)`); a point is kept when its distance is **strictly greater** than 5 m; endpoints kept.
- **Hex metres** (`refHexMeters`): each simplified segment is walked in 0.05 m steps; every cell change
  is bracketed and bisected to 0.1 mm; lengths are haversine between the split points; cells < 0.01 m
  dropped; output sorted by cell string; metres rounded to 3 decimals. This deliberately differs from
  the package's pure bisection (0.05 m bracket, crossing = outer bracket point) so the two agree only
  if both are right; the fixture tolerance is ±0.5 m.
- **Reckoning** (`refReckon`): cap per `(faction, user)` at 2000; `strength' = strength × 0.5 +
  Σ capped + Σ bonus`; drop < 0.001; ownership table with the tie and incumbent-below-minimum
  interpretations spelled out in `README.md`; captain = top capped walker of the owning faction.

## `latlng-to-cell`

180 uniform random points in lat 53.90–56.45, lon 20.90–26.85 rounded to 6 decimals (so every
consumer parses the identical double), then the 20 hand-picked points listed in `README.md`.
`near-cell-edge-1m` is built from the town-hall cell: midpoint of the edge between boundary vertices
0 and 1, moved 1 m toward the cell centre. `pentagon-res9` is the centre of the lexicographically
first `getPentagons(9)` cell.

## `walk-paths` geometry

All walks start at 2026-09-07T08:00:00Z with one sample every 5 s and are rounded to 7 decimals
(~1 cm). `hAcc` defaults to 8 m, `speed` to 1.4 m/s.

| Case | Geometry |
|---|---|
| `straight-line` | From 54.89, 23.90 on bearing 45°, 7 m per sample (1.4 m/s) with ±1.5 m lateral jitter (removed by DP). Sample at 140 m has `hAcc` 80 (rejected). After the sample at 350 m the GPS "drops out": the next sample is 399 m further along and 285 s later (57 × 5 s, still 1.4 m/s), producing one sparse segment that crosses **two** cell boundaries (asserted by the generator). Then 7 m per sample to 1200 m. `pedometerSteps` 1500. |
| `edge-hugging` | Cell `C = latLngToCell(54.91, 23.95, 9)`, edge from boundary vertex 0 to vertex 1 (bearing `b`). Sample `i` (0…30) is `along = 10 + 5·i` m from vertex 0 and `lateral = [0, 4, 8, 4, 0, −4, −8, −4][i mod 8]` m across the edge (bearing `b + 90°`): a triangular wave of amplitude 8 m and period 40 m. Speed 1.3 m/s reported, ≈ 1.28 m/s implied. The generator asserts exactly the two cells sharing the edge get metres and that the edge is ≥ 170 m long. |
| `loop-inside-one-cell` | 42 points on a circle of radius 40 m around the centre of `latLngToCell(54.88, 23.88, 9)` (bearings 0°, 360/42°, …) plus a 43rd sample equal to the first (closed loop). Speed 1.2 m/s. Asserted to yield exactly one cell. |
| `noisy-zigzag` | From 54.92, 23.87: 300 m east then 300 m north, 6.5 m per sample, each sample displaced by uniform ±6 m laterally and ±1.5 m along-track, `hAcc` 5–15, `speed` 1.1–1.5 (seeded). Rejects: seq 10 and 40 `hAcc` 120; seq 60 `speed` 5.5; seq 70 timestamp 8 s earlier than seq 69. |
| `teleport` | From 54.87, 23.94 on bearing 135°: 7 m per sample to 301 m, then the next sample is 400 m further (5 s later, implied 80 m/s, reported `speed` still 1.4), then 7 m per sample to 897 m. `alt` is `null` on the first leg. |
| `car-speed` | From 54.9303, 23.98 due west, 75 m per sample for 40 samples (3 km, 15 m/s), no `speed` key at all, `hAcc` 12, `pedometerSteps` 120. The start latitude was chosen so the smallest cell credit is ~58 m (no sub-metre corner clip). |

## `reckoning-weeks`

Cells are the ten lexicographically first cells of `gridDisk(kaunasTownHallCell, 2)`; weeks
`2026-W35`…`2026-W37`. Each cell case is a script of contributions/bonuses per week; the reference
reckoning is applied week after week (initial state `{owner: null, strengths: []}`) and its outputs
become the fixture's `expected`. Parent cases are literal and cross-checked against
`refParentOwner`.
