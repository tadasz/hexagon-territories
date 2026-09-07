# @nature/walk-sim

GPX/GeoJSON → timed sample batches. Replays recorded tracks against any Nature Explorer API
environment as a signed-in player (at real time or accelerated, with optional distortions) and
prints the **expected** per-hexagon metres of a track without contacting the API — the oracle the
API integration tests assert against (`specs/003-walk-tracking/research.md` R14, R15).

## Usage

```bash
pnpm --filter @nature/walk-sim build        # once; the bin is dist/cli.js

# Expected result of a track, no network (JSON: acceptedSeqs, rejected, flags, distanceM,
# simplifiedPointCount, hexes[{cell, meters}], sampleCount, pedometerSteps)
pnpm --filter @nature/walk-sim walk-sim dry-run packages/walk-sim/samples/azuolynas-loop.gpx --json

# Replay against a running API as the player behind the token
pnpm --filter @nature/walk-sim walk-sim replay packages/walk-sim/samples/azuolynas-loop.gpx \
  --base-url http://localhost:3000 --token "$TOKEN" --rate 60 --json

# Regenerate the checked-in sample tracks (byte-identical; refuses when an assertion fails)
pnpm --filter @nature/walk-sim samples:generate

# Reckon a week that has ended through the admin endpoint (feature 004; the token needs role admin)
pnpm --filter @nature/walk-sim walk-sim reckon 2026-W37 --base-url http://localhost:3000 --token "$TOKEN_ADMIN" --dry-run   # prints the flips, writes nothing
pnpm --filter @nature/walk-sim walk-sim reckon 2026-W37 --base-url http://localhost:3000 --token "$TOKEN_ADMIN"             # runs it
```

`pnpm --filter @nature/walk-sim walk-sim …` runs `src/cli.ts` through `tsx` (add `--silent`
before `--filter` to keep pnpm's banner out of piped JSON); after a build the same commands
work as `pnpm --filter @nature/walk-sim exec walk-sim …` or from the API package
(`pnpm --filter @nature/api exec walk-sim …` — it depends on this one, so the bin is linked
there). A relative track path is resolved against the directory pnpm was invoked from
(`INIT_CWD`), so repository-relative paths work with `--filter`.

| Command            | Options                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dry-run <file>`   | distortion flags below; `--json`                                                                                                                                                                                                                                                                                          |
| `replay <file>`    | `--base-url <url>` `--token <jwt>` (required); `--no-finish`; `--rate <n>` (0 = as fast as possible, default; 1 = real time; N = N× faster — batches are sent when the simulated clock passes each 60 s window, like the app's outbox); `--batch-size <n>` (≤ 200); `--client-walk-id <uuid>`; `--json`; distortion flags |
| `samples:generate` | `--dir <dir>`                                                                                                                                                                                                                                                                                                             |
| `reckon <weekId>`  | `--base-url <url>` `--token <jwt>` (required; **an admin token** — `UPDATE users SET role = 'admin'`); `--dry-run` (print the would-be flips, write nothing; always synchronous); `--async` (enqueue the job, answer 202); `--json`. Exit 0 on success, 1 on an API error (prints the code, e.g. `FORBIDDEN`, `WEEK_NOT_ENDED`, `RECKONING_OUT_OF_ORDER`), 2 on bad arguments |

Distortion flags (both commands): `--speed <m/s>` (resample at a constant pace; default: the
track's own timestamps, else 1.4), `--jitter <m>` (Gaussian σ, seeded), `--accuracy <m>` (reported
`hAcc`, default 8), `--teleport` (one 400 m jump at the midpoint), `--spoof-no-steps` (0
pedometer steps), `--steps <n>`, `--no-report-speed` (hide the device speed, as a spoofed device
would), `--seed <n>` (default 20260907), `--start-at <iso>`, `--sample-every <s>` (default 5).

Unless `--start-at` pins the clock, `replay` re-times the track so its last sample is a second
before "now" (intervals kept): the server clamps `startedAt` to the last 12 hours and refuses an
`endedAt` before it, so a track recorded on another day would never finish otherwise. The
week the walk counts for is therefore the current ISO week.

Batching mirrors the app's outbox: a batch closes at 200 samples or after 60 s of wall time.
With `--rate 0` (an offline drain) there is no time window, so a 35-minute track goes up in two
batches; with `--rate N` a batch closes every 60 s × N of sample time, i.e. once per real minute,
which keeps a replay under the 30 batches / 15 min ingest limit at any acceleration.

`replay` exits 1 and prints the API's error envelope on any non-2xx answer other than `429`; a
`429` is retried after its `retry-after`.

## Library

```ts
import { parseTrack, simulate, expected, replay, SAMPLE_TRACKS } from '@nature/walk-sim';

const track = parseTrack(readFileSync(SAMPLE_TRACKS.azuolynasLoop, 'utf8'), 'gpx');
const sim = simulate(track, { jitterM: 2 }); // { samples, pedometerSteps, distanceM }
const oracle = expected(sim.samples, sim.pedometerSteps);
const result = await replay(sim.samples, sim.pedometerSteps, { baseUrl, token, rate: 0 });
```

- `parseTrack(text, 'gpx' | 'geojson')` → `Track { name, points: [{ lat, lon, ts?, ele? }], hints? }`.
  GPX 1.1 `trk/trkseg/trkpt` (segments concatenated); GeoJSON `LineString`, `Feature<LineString>`
  (optional `properties.coordTimes`) or the first LineString of a `FeatureCollection`.
- `simulate(track, options)` → one sample per `sampleEveryS` along the track (`seq` from 0), then
  the distortions, deterministic per seed. `speed` is the implied pace unless `reportSpeed: false`.
- `expected(samples, pedometerSteps)` — **the oracle contract**: exactly the `finishWalk`
  pipeline of `packages/territory-rules/README.md` (`acceptSamples` → `walkFlags` →
  `simplifyPath` → `pathLengthM` → `pathToHexMeters`), computed with `@nature/territory-rules`
  and nothing else. `test/expected.test.ts` proves it reproduces every `walk-paths.json` fixture
  case. The API's `finishWalk` must match it within 0.05 m per cell (SC-001); the integration
  tests in `apps/api/test/integration/walks-finish.test.ts` import `simulate` and `expected`
  directly (no subprocess) and drive the routes with `app.inject`.
- `replay(samples, steps, options)` → `{ walkId, created, batches, summary }`; `fetch` and
  `sleep` are injectable for tests.

### Track hints

A track file may carry simulation defaults so a plain `dry-run` reproduces a scenario: GPX
`<trk><extensions>` in the `ne` namespace (`https://natureexplorer.app/gpx/walk-sim/1`) with
`<ne:pedometerSteps>` and `<ne:reportSpeed>`, or GeoJSON `properties.pedometerSteps` /
`properties.reportSpeed`. Command-line flags override them.

## Sample tracks

Generated by `scripts/generate-samples.ts` (seed 20260907; the geometry lives in
`src/sample-tracks.ts`), asserted before writing and by `test/samples.test.ts`. Synthetic
geometry around Kaunas — no third-party data.

| File                                 | Track                                                                                            | Samples | Expected                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ | ------- | ----------------------------------------------------------------- |
| `samples/azuolynas-loop.gpx`         | ~2.7 km loop in Ąžuolynas park around 54.9035 N, 23.9320 E, 1.35 m/s, ±2 m jitter, ~33 min       | 392     | no flags, 10 res-9 cells                                          |
| `samples/laisves-aleja-straight.gpx` | ~1.6 km along Laisvės alėja, 54.8964 N 23.9040 E → 54.8976 N 23.9290 E, 1.4 m/s                  | 230     | no flags, 8 res-9 cells                                           |
| `samples/car-a1.gpx`                 | ~5.3 km drive 54.9050 N 23.9400 E → 54.9300 N 24.0100 E at 20 m/s; hints: speed hidden, 60 steps | 54      | flags `teleport`, `speed`, `no_steps` (21 cells, no contribution) |

The GPX points are the 5 s samples themselves, so replaying a file by its timestamps reproduces
the same samples; `--speed`/`--jitter` re-derive them from the geometry.

## Tests

```bash
pnpm --filter @nature/walk-sim test lint typecheck build
```
