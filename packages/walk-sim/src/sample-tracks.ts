import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LatLng, WalkFlag } from '@nature/territory-rules';
import { expected } from './expected.js';
import { destination } from './geo.js';
import { parseGpx, renderGpx } from './gpx.js';
import { mulberry32 } from './random.js';
import { SAMPLES_DIR } from './samples.js';
import { simulate } from './simulate.js';
import type { Track, TrackPoint } from './track.js';

/** Seed of the sample-track generator (the fixtures' seed). */
export const SAMPLES_SEED = 20260907;
export const SAMPLES_CREATOR = `@nature/walk-sim samples:generate (seed ${String(SAMPLES_SEED)})`;

/** What each committed file must satisfy (research.md R15); asserted before writing and by tests. */
export interface SampleTrackSpec {
  file: string;
  name: string;
  description: string;
  minCells: number;
  flags: WalkFlag[];
}

export const SAMPLE_TRACK_SPECS: readonly SampleTrackSpec[] = [
  {
    file: 'azuolynas-loop.gpx',
    name: 'azuolynas-loop',
    description:
      'About 2.6 km loop inside Ąžuolynas park (Kaunas) around 54.9035 N, 23.9320 E at 1.35 m/s with ±2 m GPS jitter; roughly 32 minutes; expected: no flags, at least 4 res-9 cells',
    minCells: 4,
    flags: [],
  },
  {
    file: 'laisves-aleja-straight.gpx',
    name: 'laisves-aleja-straight',
    description:
      'About 1.6 km walk along Laisvės alėja from 54.8964 N, 23.9040 E to 54.8976 N, 23.9290 E at 1.4 m/s with ±1 m jitter; expected: no flags, at least 5 res-9 cells',
    minCells: 5,
    flags: [],
  },
  {
    file: 'car-a1.gpx',
    name: 'car-a1',
    description:
      'About 5.3 km drive along Savanorių prospektas towards the A1 from 54.9050 N, 23.9400 E to 54.9300 N, 24.0100 E at 20 m/s with the device speed hidden and 60 pedometer steps; expected flags: teleport, speed, no_steps',
    minCells: 1,
    flags: ['teleport', 'speed', 'no_steps'],
  },
];

const STEP_S = 5;

function loopVertices(rng: () => number): LatLng[] {
  const centre: LatLng = { lat: 54.9035, lon: 23.932 };
  const phase1 = rng() * 2 * Math.PI;
  const phase2 = rng() * 2 * Math.PI;
  const vertices: LatLng[] = [];
  for (let i = 0; i <= 36; i += 1) {
    const theta = (i % 36) * (Math.PI / 18);
    const radius =
      410 * (1 + 0.12 * Math.sin(2 * theta + phase1) + 0.08 * Math.sin(3 * theta + phase2));
    vertices.push(destination(centre, (theta * 180) / Math.PI, radius));
  }
  return vertices;
}

function straightVertices(rng: () => number): LatLng[] {
  const from: LatLng = { lat: 54.8964, lon: 23.904 };
  const to: LatLng = { lat: 54.8976, lon: 23.929 };
  const vertices: LatLng[] = [from];
  // A few metres of sideways wander every ~150 m, like a pavement walk.
  for (let i = 1; i < 11; i += 1) {
    const t = i / 11;
    const p = { lat: from.lat + (to.lat - from.lat) * t, lon: from.lon + (to.lon - from.lon) * t };
    vertices.push(destination(p, 0, (rng() - 0.5) * 6));
  }
  vertices.push(to);
  return vertices;
}

function carVertices(): LatLng[] {
  return [
    { lat: 54.905, lon: 23.94 },
    { lat: 54.9085, lon: 23.952 },
    { lat: 54.9125, lon: 23.968 },
    { lat: 54.918, lon: 23.985 },
    { lat: 54.9245, lon: 23.999 },
    { lat: 54.93, lon: 24.01 },
  ];
}

function recorded(
  name: string,
  vertices: LatLng[],
  speedMps: number,
  jitterM: number,
  rng: () => number,
): Track {
  const raw: Track = { name, points: vertices.map((v) => ({ lat: v.lat, lon: v.lon })) };
  const sim = simulate(raw, {
    speedMps,
    jitterM,
    sampleEveryS: STEP_S,
    seed: Math.floor(rng() * 2 ** 31),
    startAt: '2026-09-07T08:00:00.000Z',
  });
  const points: TrackPoint[] = sim.samples.map((s) => ({ lat: s.lat, lon: s.lon, ts: s.ts }));
  return { name, points };
}

/** The three tracks as in-memory `Track`s (deterministic for `SAMPLES_SEED`). */
export function buildSampleTracks(seed = SAMPLES_SEED): Track[] {
  const rng = mulberry32(seed);
  const loop = recorded('azuolynas-loop', loopVertices(rng), 1.35, 2, rng);
  const straight = recorded('laisves-aleja-straight', straightVertices(rng), 1.4, 1, rng);
  const car = recorded('car-a1', carVertices(), 20, 0, rng);
  car.hints = { pedometerSteps: 60, reportSpeed: false };
  return [loop, straight, car];
}

export interface SampleTrackReport {
  file: string;
  cells: number;
  flags: WalkFlag[];
  distanceM: number;
  sampleCount: number;
}

/** Checks a rendered file against its spec; throws with the report on a mismatch. */
export function assertSampleTrack(spec: SampleTrackSpec, gpx: string): SampleTrackReport {
  const sim = simulate(parseGpx(gpx));
  const exp = expected(sim.samples, sim.pedometerSteps);
  const report: SampleTrackReport = {
    file: spec.file,
    cells: exp.hexes.length,
    flags: exp.flags,
    distanceM: Math.round(exp.distanceM),
    sampleCount: sim.samples.length,
  };
  const flagsMatch = JSON.stringify(exp.flags) === JSON.stringify(spec.flags);
  if (!flagsMatch || exp.hexes.length < spec.minCells) {
    throw new Error(
      `${spec.file} violates its spec (want flags ${JSON.stringify(spec.flags)}, ≥ ${String(spec.minCells)} cells): ${JSON.stringify(report)}`,
    );
  }
  return report;
}

/** Renders every sample track, asserts the R15 properties and returns `{ file → gpx }`. */
export function renderSampleTracks(seed = SAMPLES_SEED): Map<string, string> {
  const files = new Map<string, string>();
  const tracks = buildSampleTracks(seed);
  for (const spec of SAMPLE_TRACK_SPECS) {
    const track = tracks.find((t) => t.name === spec.name);
    if (!track) throw new Error(`no track built for ${spec.name}`);
    const gpx = renderGpx(track, { creator: SAMPLES_CREATOR, description: spec.description });
    assertSampleTrack(spec, gpx);
    files.set(spec.file, gpx);
  }
  return files;
}

/** Writes `samples/*.gpx` (or into `dir`); refuses when an assertion fails. */
export function generateSampleFiles(dir: string = SAMPLES_DIR): SampleTrackReport[] {
  const files = renderSampleTracks();
  mkdirSync(dir, { recursive: true });
  const reports: SampleTrackReport[] = [];
  for (const spec of SAMPLE_TRACK_SPECS) {
    const gpx = files.get(spec.file)!;
    writeFileSync(join(dir, spec.file), gpx);
    reports.push(assertSampleTrack(spec, gpx));
  }
  return reports;
}
