/**
 * Deterministic fixture generator for `@nature/h3-fixtures`.
 *
 *   pnpm --filter @nature/h3-fixtures generate
 *
 * Everything is seeded (mulberry32, seed 20260907) so re-running produces byte-identical
 * files. Expected values for `walk-paths` and `reckoning-weeks` come from the intentionally
 * straightforward reference implementations in this file, NOT from `@nature/territory-rules`,
 * so a bug in the package cannot leak into the expectations (research.md R3). Geometry of each
 * case is described in `scripts/README-generator.md`; the hand review in `README.md`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Value } from '@sinclair/typebox/value';
import {
  cellToBoundary,
  cellToLatLng,
  cellToParent,
  getPentagons,
  gridDisk,
  latLngToCell,
} from 'h3-js';
import { format, resolveConfig } from 'prettier';
import {
  FIXTURE_SCHEMAS,
  type FixtureName,
  type FixtureOf,
  type HexMeters,
  type LatLng,
  type LatLngToCellCase,
  type ParentCase,
  type RawContribution,
  type ReckoningCellCase,
  type ReckoningWeekCase,
  type RejectReason,
  type Sample,
  type WalkFlag,
  type WalkPathCase,
  type ZoomResolutionCase,
} from '../src/schema.js';

export const SEED = 20260907;
const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES_DIR = join(PACKAGE_DIR, 'fixtures');
const SCHEMA_DIR = join(PACKAGE_DIR, 'schema');

// ---------------------------------------------------------------------------
// PRNG
// ---------------------------------------------------------------------------

/** mulberry32: tiny, seedable, deterministic across platforms. Returns [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Reference geometry (independent of @nature/territory-rules)
// ---------------------------------------------------------------------------

const EARTH_RADIUS_M = 6371008.8;
const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;
const round = (x: number, places: number): number => {
  const f = 10 ** places;
  return Math.round(x * f) / f;
};

/** Longitude difference `to - from` normalised to (-180, 180]. */
function deltaLon(from: number, to: number): number {
  let d = to - from;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}
function normalizeLon(lon: number): number {
  let l = lon;
  while (l > 180) l -= 360;
  while (l < -180) l += 360;
  return l;
}

function haversineM(a: LatLng, b: LatLng): number {
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dp = p2 - p1;
  const dl = rad(deltaLon(a.lon, b.lon));
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Spherical forward geodesic: the point `distM` from `p` along `bearingDeg`. */
function destination(p: LatLng, bearingDeg: number, distM: number): LatLng {
  const d = distM / EARTH_RADIUS_M;
  const b = rad(bearingDeg);
  const p1 = rad(p.lat);
  const l1 = rad(p.lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 =
    l1 +
    Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: deg(p2), lon: normalizeLon(deg(l2)) };
}

/** Initial bearing (degrees, 0..360) from `a` to `b`. */
function bearingDeg(a: LatLng, b: LatLng): number {
  const p1 = rad(a.lat);
  const p2 = rad(b.lat);
  const dl = rad(deltaLon(a.lon, b.lon));
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Linear interpolation in lat/lon, antimeridian-safe through `deltaLon`. */
function lerp(a: LatLng, b: LatLng, t: number): LatLng {
  return {
    lat: a.lat + t * (b.lat - a.lat),
    lon: normalizeLon(a.lon + t * deltaLon(a.lon, b.lon)),
  };
}

function roundLatLng(p: LatLng): LatLng {
  return { lat: round(p.lat, 7), lon: round(p.lon, 7) };
}

function cellOf(p: LatLng, res: number): string {
  return latLngToCell(p.lat, p.lon, res);
}

// ---------------------------------------------------------------------------
// Reference walk pipeline
// ---------------------------------------------------------------------------

const REF = {
  MAX_HACC: 50,
  MAX_SPEED: 5,
  TELEPORT: 8,
  MAX_MEDIAN: 3.5,
  MAX_DIST: 30000,
  MAX_DUR_S: 21600,
  MIN_STEPS_PER_M: 0.5,
  NO_STEPS_MIN_DIST: 500,
  CAP: 2000,
  DECAY: 0.5,
  MIN_STRENGTH: 500,
  HYSTERESIS: 0.1,
  PARENT_PLURALITY: 0.4,
  PARENT_MIN_CLAIMED: 2,
};

function refAccept(samples: Sample[]): {
  accepted: Sample[];
  rejected: { seq: number; reason: RejectReason }[];
} {
  const sorted = samples.slice().sort((a, b) => a.seq - b.seq);
  const accepted: Sample[] = [];
  const rejected: { seq: number; reason: RejectReason }[] = [];
  let lastTs = Number.NEGATIVE_INFINITY;
  for (const s of sorted) {
    const ts = Date.parse(s.ts);
    if (!(ts > lastTs)) rejected.push({ seq: s.seq, reason: 'non_monotonic' });
    else if (s.hAcc > REF.MAX_HACC) rejected.push({ seq: s.seq, reason: 'accuracy' });
    else if (s.speed !== undefined && s.speed !== null && s.speed > REF.MAX_SPEED)
      rejected.push({ seq: s.seq, reason: 'speed' });
    else {
      accepted.push(s);
      lastTs = ts;
    }
  }
  return { accepted, rejected };
}

function refFlags(accepted: Sample[], pedometerSteps: number | undefined): WalkFlag[] {
  const flags: WalkFlag[] = [];
  const speeds: number[] = [];
  let dist = 0;
  for (let i = 1; i < accepted.length; i++) {
    const a = accepted[i - 1]!;
    const b = accepted[i]!;
    const d = haversineM(a, b);
    const dt = (Date.parse(b.ts) - Date.parse(a.ts)) / 1000;
    dist += d;
    speeds.push(d / dt);
  }
  const first = accepted[0];
  const last = accepted[accepted.length - 1];
  const durationS = first && last ? (Date.parse(last.ts) - Date.parse(first.ts)) / 1000 : 0;
  if (speeds.some((v) => v > REF.TELEPORT)) flags.push('teleport');
  if (speeds.length > 0) {
    const s = speeds.slice().sort((x, y) => x - y);
    const mid = Math.floor(s.length / 2);
    const median = s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
    if (median > REF.MAX_MEDIAN) flags.push('speed');
  }
  if (dist > REF.MAX_DIST || durationS > REF.MAX_DUR_S) flags.push('distance');
  if (
    pedometerSteps !== undefined &&
    dist > REF.NO_STEPS_MIN_DIST &&
    pedometerSteps / dist < REF.MIN_STEPS_PER_M
  )
    flags.push('no_steps');
  return flags;
}

/** Douglas–Peucker in a local equirectangular frame centred on the path's bounding box. */
function refSimplify(points: LatLng[], toleranceM: number): LatLng[] {
  if (points.length < 3) return points.slice();
  const lats = points.map((p) => p.lat);
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const lon0 = points[0]!.lon;
  const k = Math.cos(rad(lat0));
  const xy = points.map((p) => ({
    x: EARTH_RADIUS_M * rad(deltaLon(lon0, p.lon)) * k,
    y: EARTH_RADIUS_M * rad(p.lat - lat0),
  }));
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop()!;
    let maxD = -1;
    let maxI = -1;
    for (let i = s + 1; i < e; i++) {
      const d = segmentDistance(xy[i]!, xy[s]!, xy[e]!);
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxI >= 0 && maxD > toleranceM) {
      keep[maxI] = true;
      stack.push([s, maxI], [maxI, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

type XY = { x: number; y: number };
function segmentDistance(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = a.x + t * dx;
  const qy = a.y + t * dy;
  return Math.hypot(p.x - qx, p.y - qy);
}

/**
 * Reference split: walk each segment in 0.05 m steps to find every cell change, then bisect the
 * bracketing step to 0.1 mm. Slower but method-independent from the package's pure bisection.
 */
function refHexMeters(points: LatLng[], res: number): HexMeters[] {
  const acc = new Map<string, number>();
  const credit = (cell: string, m: number) => acc.set(cell, (acc.get(cell) ?? 0) + m);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = haversineM(a, b);
    if (len === 0) continue;
    const steps = Math.max(1, Math.ceil(len / 0.05));
    let startT = 0;
    let cur = cellOf(a, res);
    let k = 1;
    while (k <= steps) {
      const t = k / steps;
      const c = cellOf(lerp(a, b, t), res);
      if (c === cur) {
        k++;
        continue;
      }
      let lo = (k - 1) / steps;
      let hi = t;
      while (haversineM(lerp(a, b, lo), lerp(a, b, hi)) > 0.0001) {
        const mid = (lo + hi) / 2;
        if (cellOf(lerp(a, b, mid), res) === cur) lo = mid;
        else hi = mid;
      }
      credit(cur, haversineM(lerp(a, b, startT), lerp(a, b, hi)));
      startT = hi;
      cur = cellOf(lerp(a, b, hi), res);
      // re-check the same step against the new cell (a third cell may sit between)
    }
    credit(cur, haversineM(lerp(a, b, startT), b));
  }
  return [...acc.entries()]
    .filter(([, m]) => m >= 0.01)
    .map(([cell, meters]) => ({ cell, meters: round(meters, 3) }))
    .sort((x, y) => (x.cell < y.cell ? -1 : x.cell > y.cell ? 1 : 0));
}

function pathLength(points: LatLng[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversineM(points[i - 1]!, points[i]!);
  return d;
}

function refWalkExpected(input: WalkPathCase['input']): WalkPathCase['expected'] {
  const { accepted, rejected } = refAccept(input.samples);
  const flags = refFlags(accepted, input.pedometerSteps);
  const simplified = refSimplify(
    accepted.map((s) => ({ lat: s.lat, lon: s.lon })),
    input.simplifyToleranceM,
  );
  return {
    acceptedSeqs: accepted.map((s) => s.seq),
    rejected,
    flags,
    distanceM: round(pathLength(simplified), 3),
    simplifiedPointCount: simplified.length,
    hexMeters: refHexMeters(simplified, input.resolution),
  };
}

// ---------------------------------------------------------------------------
// latlng-to-cell.json
// ---------------------------------------------------------------------------

function expectedFor(p: LatLng): LatLngToCellCase['expected'] {
  const r9 = latLngToCell(p.lat, p.lon, 9);
  const vertices = cellToBoundary(r9).length;
  if (vertices !== 5 && vertices !== 6 && vertices !== 10)
    throw new Error(`unexpected vertex count ${vertices}`);
  return {
    r9,
    parents: {
      r8: cellToParent(r9, 8),
      r7: cellToParent(r9, 7),
      r6: cellToParent(r9, 6),
      r5: cellToParent(r9, 5),
    },
    boundaryVertexCount: vertices,
  };
}

/** A point 1 m inside a res-9 cell from the midpoint of its first edge. */
function nearEdgePoint(lat: number, lon: number): LatLng {
  const cell = latLngToCell(lat, lon, 9);
  const [v0, v1] = cellToBoundary(cell) as [number, number][];
  const [clat, clon] = cellToLatLng(cell);
  const mid = { lat: (v0![0] + v1![0]) / 2, lon: (v0![1] + v1![1]) / 2 };
  const toCentre = bearingDeg(mid, { lat: clat, lon: clon });
  return destination(mid, toCentre, 1);
}

export function latLngToCellCases(): FixtureOf<'latlng-to-cell'> {
  const rng = mulberry32(SEED);
  const [pentagon] = getPentagons(9).slice().sort();
  const [plat, plon] = cellToLatLng(pentagon!);
  const handPicked: [string, LatLng][] = [
    ['kaunas-town-hall', { lat: 54.8969, lon: 23.8862 }],
    ['kaunas-azuolynas-park', { lat: 54.9004, lon: 23.9313 }],
    ['kaunas-nemunas-island', { lat: 54.8918, lon: 23.9143 }],
    ['kaunas-castle', { lat: 54.899, lon: 23.885 }],
    ['vilnius-cathedral', { lat: 54.6858, lon: 25.2877 }],
    ['klaipeda-old-town', { lat: 55.7033, lon: 21.1443 }],
    ['nida', { lat: 55.3033, lon: 21.0053 }],
    ['near-cell-edge-1m', roundLatLng(nearEdgePoint(54.8969, 23.8862))],
    ['antimeridian-east', { lat: 66, lon: 179.9999 }],
    ['antimeridian-west', { lat: 66, lon: -179.9999 }],
    ['north-pole', { lat: 89.999, lon: 0 }],
    ['south-pole', { lat: -89.999, lon: 0 }],
    ['equator-prime-meridian', { lat: 0, lon: 0 }],
    ['pentagon-res9', roundLatLng({ lat: plat, lon: plon })],
    ['sydney', { lat: -33.8688, lon: 151.2093 }],
    ['tokyo', { lat: 35.6762, lon: 139.6503 }],
    ['nairobi', { lat: -1.2921, lon: 36.8219 }],
    ['quito', { lat: -0.1807, lon: -78.4678 }],
    ['reykjavik', { lat: 64.1466, lon: -21.9426 }],
    ['ushuaia', { lat: -54.8019, lon: -68.303 }],
  ];
  const cases: LatLngToCellCase[] = [];
  for (let i = 0; i < 180; i++) {
    const p = {
      lat: round(53.9 + rng() * (56.45 - 53.9), 6),
      lon: round(20.9 + rng() * (26.85 - 20.9), 6),
    };
    cases.push({
      id: `lt-random-${String(i).padStart(3, '0')}`,
      input: p,
      expected: expectedFor(p),
    });
  }
  for (const [id, p] of handPicked) cases.push({ id, input: p, expected: expectedFor(p) });
  const pent = cases.find((c) => c.id === 'pentagon-res9')!;
  if (pent.expected.boundaryVertexCount !== 10)
    throw new Error('pentagon case must be a class III pentagon');
  return {
    name: 'latlng-to-cell',
    description:
      '200 coordinates → res-9 cell, res 8–5 parents and boundary vertex count: 180 seeded-random points in the Lithuania bounding box (lat 53.90–56.45, lon 20.90–26.85) plus 20 hand-picked (Kaunas landmarks, Vilnius, Klaipėda, Nida, a point 1 m inside a cell edge, the antimeridian on both sides, both poles, the origin, a res-9 pentagon centre and six world cities). Pentagons at odd (class III) resolutions have 10 boundary vertices.',
    generator: 'scripts/generate.ts#latLngToCellCases',
    version: 1,
    seed: SEED,
    cases,
  };
}

// ---------------------------------------------------------------------------
// zoom-resolution.json
// ---------------------------------------------------------------------------

/** The prototype's table (`prototype/index.html` `zoomToResolution`), floored, clamped to [0, 18]. */
function refResolutionForZoom(zoom: number): number {
  const z = Math.max(0, Math.min(18, Math.floor(zoom)));
  const table = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 9];
  return table[z]!;
}

export function zoomResolutionCases(): FixtureOf<'zoom-resolution'> {
  const cases: ZoomResolutionCase[] = [];
  for (let z = 0; z <= 18; z++)
    cases.push({
      id: `z${z}`,
      input: { zoom: z },
      expected: { resolution: refResolutionForZoom(z) },
    });
  for (const z of [-1, 18.7, 20, 13.4])
    cases.push({
      id: `z${z}`,
      input: { zoom: z },
      expected: { resolution: refResolutionForZoom(z) },
    });
  return {
    name: 'zoom-resolution',
    description:
      "Map zoom → H3 resolution, the prototype's zoomToResolution table (z ≥ 16 → 9, 14–15 → 8, 12–13 → 7, 10–11 → 6, 8–9 → 5, 6–7 → 4, 4–5 → 3, 2–3 → 2, 0–1 → 1) for z = 0…18 plus four edge cases: zoom -1 → 1, 18.7 → 9, 20 → 9, 13.4 → 7 (non-integers are floored).",
    generator: 'scripts/generate.ts#zoomResolutionCases',
    version: 1,
    seed: SEED,
    cases,
  };
}

// ---------------------------------------------------------------------------
// walk-paths.json
// ---------------------------------------------------------------------------

const T0 = Date.parse('2026-09-07T08:00:00Z');
const isoTs = (ms: number): string => new Date(ms).toISOString().replace('.000Z', 'Z');

type SampleSpec = {
  p: LatLng;
  /** seconds since T0 */
  t: number;
  hAcc?: number;
  speed?: number | null;
  course?: number | null;
  alt?: number | null;
  /** omit the `speed` key entirely */
  noSpeed?: boolean;
};

function toSamples(specs: SampleSpec[]): Sample[] {
  return specs.map((s, i) => {
    const p = roundLatLng(s.p);
    const sample: Sample = {
      seq: i,
      ts: isoTs(T0 + s.t * 1000),
      lat: p.lat,
      lon: p.lon,
      hAcc: s.hAcc ?? 8,
    };
    if (!s.noSpeed) sample.speed = s.speed === undefined ? 1.4 : s.speed;
    if (s.course !== undefined) sample.course = s.course;
    if (s.alt !== undefined) sample.alt = s.alt;
    return sample;
  });
}

function makeWalkCase(
  id: string,
  description: string,
  input: Omit<WalkPathCase['input'], 'resolution' | 'simplifyToleranceM'>,
): WalkPathCase {
  const full: WalkPathCase['input'] = { resolution: 9, simplifyToleranceM: 5, ...input };
  return { id, description, input: full, expected: refWalkExpected(full) };
}

function straightLine(rng: () => number): WalkPathCase {
  const start = { lat: 54.89, lon: 23.9 };
  const bearing = 45;
  const specs: SampleSpec[] = [];
  const jitter = () => (rng() * 2 - 1) * 1.5;
  let t = 0;
  // 0 … 350 m at 7 m per 5 s
  for (let along = 0; along <= 350; along += 7, t += 5) {
    const p = destination(destination(start, bearing, along), bearing + 90, jitter());
    specs.push({ p, t, course: bearing, alt: 60, hAcc: along === 140 ? 80 : 8 });
  }
  // GPS dropout: the next sample is 399 m further along, 285 s later (1.4 m/s, no teleport)
  t += 280; // last increment already added 5 s
  for (let along = 749; along <= 1200; along += 7, t += 5) {
    const p = destination(destination(start, bearing, along), bearing + 90, jitter());
    specs.push({ p, t, course: bearing, alt: 61 });
  }
  return makeWalkCase(
    'straight-line',
    '1.2 km NE (bearing 45°) from 54.89,23.90 across ≥ 4 res-9 cells, 1 sample per 5 s at 1.4 m/s with ±1.5 m lateral jitter that DP removes; one accuracy reject (hAcc 80 at 140 m); a 399 m GPS dropout (285 s) makes one sparse segment that crosses two cell boundaries; pedometer 1500 steps (plausible).',
    { pedometerSteps: 1500, samples: toSamples(specs) },
  );
}

function edgeHugging(): WalkPathCase {
  const cell = latLngToCell(54.91, 23.95, 9);
  const boundary = cellToBoundary(cell).map(([lat, lon]) => ({ lat: lat, lon: lon }));
  const v0 = boundary[0]!;
  const v1 = boundary[1]!;
  const edgeLen = haversineM(v0, v1);
  if (edgeLen < 170) throw new Error(`edge too short for edge-hugging: ${edgeLen}`);
  const b = bearingDeg(v0, v1);
  const tri = [0, 4, 8, 4, 0, -4, -8, -4];
  const specs: SampleSpec[] = [];
  for (let i = 0; i <= 30; i++) {
    const along = 10 + 5 * i;
    const lateral = tri[i % 8]!;
    const p = destination(destination(v0, b, along), b + 90, lateral);
    specs.push({ p, t: 5 * i, speed: 1.3, hAcc: 6, course: round(b, 1), alt: 55 });
  }
  const c = makeWalkCase(
    'edge-hugging',
    `160 m along the first edge of cell ${cell} (from 10 m to 160 m past vertex 0, edge length ${round(edgeLen, 1)} m) as a triangular wave of amplitude 8 m and period 40 m across the edge, 5 m along per 5 s (≈1.28 m/s); DP keeps the wave peaks so both neighbouring cells get metres.`,
    { samples: toSamples(specs) },
  );
  if (c.expected.hexMeters.length !== 2 || !c.expected.hexMeters.some((h) => h.cell === cell))
    throw new Error(
      `edge-hugging must touch exactly the two cells sharing the edge: ${JSON.stringify(c.expected.hexMeters)}`,
    );
  return c;
}

function loopInsideOneCell(): WalkPathCase {
  const cell = latLngToCell(54.88, 23.88, 9);
  const [clat, clon] = cellToLatLng(cell);
  const centre = { lat: clat, lon: clon };
  const n = 42;
  const specs: SampleSpec[] = [];
  for (let i = 0; i <= n; i++) {
    const angle = (360 * (i % n)) / n;
    specs.push({
      p: destination(centre, angle, 40),
      t: 5 * i,
      speed: 1.2,
      hAcc: 7,
      course: (angle + 90) % 360,
      alt: 58,
    });
  }
  const c = makeWalkCase(
    'loop-inside-one-cell',
    `A closed circle of radius 40 m around the centre of cell ${cell} (43 samples, 6 m apart, closing on the first point) — exactly one cell receives metres.`,
    { samples: toSamples(specs) },
  );
  if (c.expected.hexMeters.length !== 1)
    throw new Error('loop-inside-one-cell must yield exactly one cell');
  return c;
}

function noisyZigzag(rng: () => number): WalkPathCase {
  const start = { lat: 54.92, lon: 23.87 };
  const specs: SampleSpec[] = [];
  const legs: [number, number][] = [
    [90, 300],
    [0, 300],
  ];
  let origin = start;
  let t = 0;
  let seq = 0;
  for (const [bearing, length] of legs) {
    for (let along = 0; along < length; along += 6.5, t += 5, seq++) {
      const lateral = (rng() * 2 - 1) * 6;
      const alongJ = (rng() * 2 - 1) * 1.5;
      const p = destination(destination(origin, bearing, along + alongJ), bearing + 90, lateral);
      const spec: SampleSpec = {
        p,
        t,
        hAcc: round(5 + rng() * 10, 1),
        speed: round(1.1 + rng() * 0.4, 2),
        course: bearing,
        alt: 62,
      };
      if (seq === 10 || seq === 40) spec.hAcc = 120; // accuracy rejects
      if (seq === 60) spec.speed = 5.5; // speed reject
      if (seq === 70) spec.t = t - 8; // timestamp goes backwards → non_monotonic
      specs.push(spec);
    }
    origin = destination(origin, bearing, length);
  }
  return makeWalkCase(
    'noisy-zigzag',
    'L-shaped 600 m walk (300 m east, then 300 m north) from 54.92,23.87 with uniform ±6 m lateral and ±1.5 m along-track jitter; DP at 5 m removes most of it (expected metres are computed after DP). Rejects: seq 10 and 40 (hAcc 120), seq 60 (speed 5.5 m/s), seq 70 (timestamp 8 s before the previous accepted sample).',
    { samples: toSamples(specs) },
  );
}

function teleport(): WalkPathCase {
  const start = { lat: 54.87, lon: 23.94 };
  const bearing = 135;
  const specs: SampleSpec[] = [];
  let t = 0;
  let along = 0;
  for (; along <= 300; along += 7, t += 5)
    specs.push({ p: destination(start, bearing, along), t, course: bearing, alt: null });
  along = along - 7 + 400; // 400 m jump in 5 s
  for (; along <= 900; along += 7, t += 5)
    specs.push({ p: destination(start, bearing, along), t, course: bearing, alt: 64 });
  return makeWalkCase(
    'teleport',
    '300 m SE at 1.4 m/s, then the next sample (5 s later) is 400 m further along the same line (implied 80 m/s), then 200 m more at walking pace. The jump sample is kept (reported speed 1.4 m/s), the walk is flagged `teleport`, and the 400 m jump segment is still split into hex metres.',
    { samples: toSamples(specs) },
  );
}

function carSpeed(): WalkPathCase {
  const start = { lat: 54.9303, lon: 23.98 };
  const bearing = 270;
  const specs: SampleSpec[] = [];
  for (let i = 0; i <= 40; i++)
    specs.push({
      p: destination(start, bearing, 75 * i),
      t: 5 * i,
      noSpeed: true,
      hAcc: 12,
      course: bearing,
      alt: 70,
    });
  return makeWalkCase(
    'car-speed',
    '3 km due west from 54.93,23.98 at 75 m per 5 s (15 m/s implied) with no `speed` values on any sample and only 120 pedometer steps: flags `teleport` (implied > 8 m/s), `speed` (median > 3.5 m/s) and `no_steps` (0.04 steps/m over > 500 m); not `distance` (< 30 km, < 6 h).',
    { pedometerSteps: 120, samples: toSamples(specs) },
  );
}

export function walkPaths(): FixtureOf<'walk-paths'> {
  const rng = mulberry32(SEED);
  const cases = [
    straightLine(rng),
    edgeHugging(),
    loopInsideOneCell(),
    noisyZigzag(rng),
    teleport(),
    carSpeed(),
  ];
  const straight = cases[0]!;
  if (straight.expected.hexMeters.length < 4) throw new Error('straight-line must cross ≥ 4 cells');
  // the sparse segment (seq 50 → 51) must cross two boundaries on its own
  const s50 = straight.input.samples[50]!;
  const s51 = straight.input.samples[51]!;
  const sparse = refHexMeters([s50, s51], 9);
  if (haversineM(s50, s51) < 390 || sparse.length < 3)
    throw new Error(`sparse segment must cross two boundaries: ${JSON.stringify(sparse)}`);
  const expectFlags: Record<string, WalkFlag[]> = {
    'straight-line': [],
    'edge-hugging': [],
    'loop-inside-one-cell': [],
    'noisy-zigzag': [],
    teleport: ['teleport'],
    'car-speed': ['teleport', 'speed', 'no_steps'],
  };
  for (const c of cases) {
    if (JSON.stringify(c.expected.flags) !== JSON.stringify(expectFlags[c.id]))
      throw new Error(
        `${c.id}: flags ${JSON.stringify(c.expected.flags)} != ${JSON.stringify(expectFlags[c.id])}`,
      );
  }
  return {
    name: 'walk-paths',
    description:
      'Six synthetic walks (straight-line, edge-hugging, loop-inside-one-cell, noisy-zigzag, teleport, car-speed) exercising acceptSamples, walkFlags, simplifyPath (Douglas–Peucker 5 m) and pathToHexMeters at res 9. Expected values come from the reference implementation in scripts/generate.ts (0.05 m stepping + bisection to 0.1 mm); tolerance ±0.5 m per cell. The sparse straight-line segment seq 50→51 crosses two cell boundaries.',
    generator: 'scripts/generate.ts#walkPaths',
    version: 1,
    seed: SEED,
    cases,
  };
}

// ---------------------------------------------------------------------------
// reckoning-weeks.json
// ---------------------------------------------------------------------------

type CellState = { owner: number | null; strengths: { factionId: number; strength: number }[] };

function refReckon(
  state: CellState,
  contributions: RawContribution[],
  bonuses: RawContribution[],
): ReckoningWeekCase['expected'] {
  // weekly cap per (faction, user)
  const sums = new Map<string, { factionId: number; userId: string; meters: number }>();
  for (const c of contributions) {
    const key = `${c.factionId}|${c.userId}`;
    const row = sums.get(key) ?? { factionId: c.factionId, userId: c.userId, meters: 0 };
    row.meters += c.meters;
    sums.set(key, row);
  }
  const capped = [...sums.values()]
    .map((r) => ({
      factionId: r.factionId,
      userId: r.userId,
      cappedMeters: Math.min(r.meters, REF.CAP),
    }))
    .sort(
      (a, b) =>
        a.factionId - b.factionId || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
    );

  // strengths
  const ids = new Set<number>();
  for (const s of state.strengths) ids.add(s.factionId);
  for (const c of capped) ids.add(c.factionId);
  for (const b of bonuses) ids.add(b.factionId);
  const strengthOf = new Map<number, number>();
  for (const id of ids) {
    const old = state.strengths.find((s) => s.factionId === id)?.strength ?? 0;
    const walk = capped.filter((c) => c.factionId === id).reduce((a, c) => a + c.cappedMeters, 0);
    const bonus = bonuses.filter((b) => b.factionId === id).reduce((a, b) => a + b.meters, 0);
    const s = old * REF.DECAY + walk + bonus;
    if (s >= 0.001) strengthOf.set(id, s);
  }
  const strengths = [...strengthOf.entries()]
    .map(([factionId, strength]) => ({ factionId, strength }))
    .sort((a, b) => a.factionId - b.factionId);

  // ownership table (docs/territory-rules.md "Weekly reckoning")
  const incumbent = state.owner;
  const s = (id: number | null): number => (id === null ? 0 : (strengthOf.get(id) ?? 0));
  const eligible = strengths.filter((f) => f.strength >= REF.MIN_STRENGTH);
  let owner: number | null;
  if (eligible.length === 0) {
    owner = null; // no faction reaches MIN_STRENGTH → unclaimed (also: incumbent below min, no challenger)
  } else {
    const top = Math.max(...eligible.map((f) => f.strength));
    const leaders = eligible.filter((f) => f.strength === top);
    if (leaders.length > 1) {
      // exact tie at the top: incumbent keeps (if it still reaches MIN), else unclaimed
      owner = incumbent !== null && s(incumbent) >= REF.MIN_STRENGTH ? incumbent : null;
    } else {
      const leader = leaders[0]!.factionId;
      if (incumbent === null || leader === incumbent) owner = leader;
      else if (s(incumbent) < REF.MIN_STRENGTH)
        owner = leader; // incumbent no longer holds; no hysteresis
      else if (top >= s(incumbent) * (1 + REF.HYSTERESIS))
        owner = leader; // challenger clears hysteresis
      else owner = incumbent; // hysteresis holds
    }
  }
  const flipped = owner !== incumbent;
  let captain: string | null = null;
  if (owner !== null) {
    const own = capped.filter((c) => c.factionId === owner && c.cappedMeters > 0);
    own.sort(
      (a, b) =>
        b.cappedMeters - a.cappedMeters || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
    );
    captain = own[0]?.userId ?? null;
  }
  const expected: ReckoningWeekCase['expected'] = { capped, strengths, owner, flipped, captain };
  if (flipped) expected.event = { from: incumbent, to: owner };
  return expected;
}

type WeekSpec = { contributions?: RawContribution[]; bonuses?: RawContribution[] };
const c = (factionId: number, userId: string, meters: number): RawContribution => ({
  factionId,
  userId,
  meters,
});

function reckoningCell(
  id: string,
  description: string,
  cell: string,
  weeks: WeekSpec[],
): ReckoningCellCase {
  const weekIds = ['2026-W35', '2026-W36', '2026-W37'];
  if (weeks.length !== weekIds.length) throw new Error(`${id}: need ${weekIds.length} weeks`);
  const initial: CellState = { owner: null, strengths: [] };
  let state = initial;
  const out: ReckoningWeekCase[] = [];
  weeks.forEach((w, i) => {
    const contributions = w.contributions ?? [];
    const bonuses = w.bonuses ?? [];
    const expected = refReckon(state, contributions, bonuses);
    out.push({ weekId: weekIds[i]!, contributions, bonuses, expected });
    state = { owner: expected.owner, strengths: expected.strengths };
  });
  return { id, description, cell, initial, weeks: out };
}

export function reckoningWeeks(): FixtureOf<'reckoning-weeks'> {
  const centre = latLngToCell(54.8969, 23.8862, 9);
  const cells = gridDisk(centre, 2).slice().sort();
  const cellAt = (i: number): string => cells[i]!;

  const cases: ReckoningCellCase[] = [
    reckoningCell(
      'no-faction-reaches-min',
      'Table row "No faction reaches MIN_STRENGTH (500 m) → unclaimed": 300/400 m in W35, decaying and topping up below 500 in W36–W37; never claimed.',
      cellAt(0),
      [
        { contributions: [c(1, 'u1', 300), c(2, 'u2', 400)] },
        { contributions: [c(1, 'u1', 100)] },
        { contributions: [c(2, 'u2', 250)] },
      ],
    ),
    reckoningCell(
      'first-claim',
      'Table row "No incumbent, one faction ≥ 500 m → that faction": 800 m claims in W35 (event null→1), then the incumbent keeps with 600 and 700 m of strength.',
      cellAt(1),
      [
        { contributions: [c(1, 'u1', 800)] },
        { contributions: [c(1, 'u1', 200)] },
        { contributions: [c(1, 'u1', 400)] },
      ],
    ),
    reckoningCell(
      'challenger-beats-hysteresis',
      'Table row "Challenger strength′ ≥ incumbent × 1.10 → challenger takes the cell": faction 2 reaches 700 vs 600 (≥ 660) in W36 and flips it; faction 1 flips it back in W37 with 500 vs 350 (≥ 385).',
      cellAt(2),
      [
        { contributions: [c(1, 'u1', 1000)] },
        { contributions: [c(1, 'u1', 100), c(2, 'u2', 700)] },
        { contributions: [c(1, 'u1', 200)] },
      ],
    ),
    reckoningCell(
      'hysteresis-holds',
      'Table row "Incumbent still ≥ 500 m and no challenger clears hysteresis → incumbent keeps": W35 as in data-model.md §1.5 (2 600 m capped to 2 000 + 300, bonus 300 for faction 2); in W36 faction 2 reaches exactly 1 312.5 = 1.05 × 1 250 and leads on strength but does not flip; W37 decays both (656.25 vs 625) and still holds.',
      cellAt(3),
      [
        { contributions: [c(1, 'u1', 2600), c(1, 'u2', 300)], bonuses: [c(2, 'u3', 300)] },
        { contributions: [c(1, 'u1', 100), c(2, 'u3', 1162.5)] },
        {},
      ],
    ),
    reckoningCell(
      'incumbent-decays-below-min-no-challenger',
      'Table row "Incumbent below 500 m and no challenger ≥ 500 m → unclaimed": 900 m claims in W35, decays to 450 in W36 with only 200 m from faction 2 → event 1→null; W37 stays unclaimed (225/100/bonus 100).',
      cellAt(4),
      [
        { contributions: [c(1, 'u1', 900)] },
        { contributions: [c(2, 'u2', 200)] },
        { bonuses: [c(3, 'u3', 100)] },
      ],
    ),
    reckoningCell(
      'exact-tie-incumbent-keeps',
      'Table row "Exact tie at the top → incumbent keeps": faction 1 owns with 600; in W36 and W37 both factions end at exactly 600 → no flip.',
      cellAt(5),
      [
        { contributions: [c(1, 'u1', 600)] },
        { contributions: [c(1, 'u1', 300), c(2, 'u2', 600)] },
        { contributions: [c(1, 'u1', 300), c(2, 'u2', 300)] },
      ],
    ),
    reckoningCell(
      'exact-tie-no-incumbent',
      'Table row "Exact tie at the top … if none, unclaimed": 700/700 in W35 and W36 stay unclaimed; W37 breaks the tie (750 vs 700) → faction 1 claims (event null→1).',
      cellAt(6),
      [
        { contributions: [c(1, 'u1', 700), c(2, 'u2', 700)] },
        { contributions: [c(1, 'u1', 350), c(2, 'u2', 350)] },
        { contributions: [c(1, 'u1', 400), c(2, 'u2', 350)] },
      ],
    ),
    reckoningCell(
      'cap-and-bonus',
      'Weekly cap and capture bonus: u1 walks 2 600 m (capped to 2 000) plus a 300 m bonus (uncapped) → 2 300; W36 faction 2 stacks two capped players (2 000 + 2 000) and a 200 m bonus → 4 700 and flips; W37 faction 1 (u1 3 000 → 2 000, u5 50) reaches 2 625 ≥ 2 350 × 1.10 and flips back.',
      cellAt(7),
      [
        { contributions: [c(1, 'u1', 2600), c(2, 'u2', 1000)], bonuses: [c(1, 'u1', 300)] },
        { contributions: [c(2, 'u2', 2000), c(2, 'u4', 2500)], bonuses: [c(2, 'u2', 200)] },
        { contributions: [c(1, 'u1', 3000), c(1, 'u5', 50)] },
      ],
    ),
    reckoningCell(
      'incumbent-below-min-challenger-above-min',
      'Gap in the table pinned by this fixture: incumbent decays to 480 (< 500) while a challenger reaches 520 (≥ 500 but < 480 × 1.10 = 528). An incumbent below MIN_STRENGTH no longer holds the cell, so hysteresis does not protect it → challenger takes it (event 1→2). W37 both decay below 500 → unclaimed (event 2→null).',
      cellAt(8),
      [
        { contributions: [c(1, 'u1', 960)] },
        { contributions: [c(2, 'u2', 520)] },
        { contributions: [c(2, 'u2', 100)] },
      ],
    ),
    reckoningCell(
      'bonus-only',
      'Bonuses alone can claim: bird (300) + plant (200) bonuses reach exactly 500 = MIN_STRENGTH → faction 3 claims with no walk metres (captain null); W36 decays to 250 → unclaimed; W37 250 × 0.5 + 300 = 425 → still unclaimed.',
      cellAt(9),
      [{ bonuses: [c(3, 'u3', 300), c(3, 'u3', 200)] }, {}, { bonuses: [c(3, 'u3', 300)] }],
    ),
  ];

  const parentCases: ParentCase[] = [
    {
      id: 'plurality-42pct',
      input: { childOwners: [1, 1, 1, 2, 2, 3, 3, null] },
      expected: { owner: 1 },
    },
    { id: 'tie', input: { childOwners: [1, 1, 2, 2, null] }, expected: { owner: null } },
    { id: 'one-claimed-child', input: { childOwners: [1, null, null] }, expected: { owner: null } },
    { id: 'no-claimed', input: { childOwners: [null, null] }, expected: { owner: null } },
    {
      id: 'exactly-40pct-not-enough',
      input: { childOwners: [1, 1, 2, 3, 2] },
      expected: { owner: null },
    },
    {
      id: 'exactly-40pct-no-tie',
      input: { childOwners: [1, 1, 1, 1, 2, 2, 2, 3, 3, 3] },
      expected: { owner: null },
    },
    {
      id: 'two-claimed-same-faction',
      input: { childOwners: [2, 2, null, null, null, null, null] },
      expected: { owner: 2 },
    },
    {
      id: 'all-seven-one-faction',
      input: { childOwners: [3, 3, 3, 3, 3, 3, 3] },
      expected: { owner: 3 },
    },
  ];
  for (const p of parentCases) {
    if (refParentOwner(p.input.childOwners) !== p.expected.owner)
      throw new Error(`parent case ${p.id} disagrees with reference`);
  }

  return {
    name: 'reckoning-weeks',
    description:
      'Three ISO weeks (UTC) of contributions for ten res-9 cells around Kaunas town hall, one per row of the ownership table in docs/territory-rules.md plus cap/bonus, decay-to-unclaimed, bonus-only and the incumbent-below-min gap: no-faction-reaches-min, first-claim, challenger-beats-hysteresis, hysteresis-holds, incumbent-decays-below-min-no-challenger, exact-tie-incumbent-keeps, exact-tie-no-incumbent, cap-and-bonus, incumbent-below-min-challenger-above-min, bonus-only. Week N+1 initial state is week N expected. parentCases cover deriveParentOwner (plurality > 40 % of ≥ 2 claimed children, ties unclaimed).',
    generator: 'scripts/generate.ts#reckoningWeeks',
    version: 1,
    seed: SEED,
    factions: [1, 2, 3],
    weeks: ['2026-W35', '2026-W36', '2026-W37'],
    cells: cases,
    parentCases,
  };
}

function refParentOwner(childOwners: (number | null)[]): number | null {
  const counts = new Map<number, number>();
  let claimed = 0;
  for (const o of childOwners) {
    if (o === null) continue;
    claimed++;
    counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  if (claimed < REF.PARENT_MIN_CLAIMED) return null;
  const top = Math.max(...counts.values());
  const leaders = [...counts.entries()].filter(([, n]) => n === top);
  if (leaders.length !== 1) return null;
  return top / claimed > REF.PARENT_PLURALITY ? leaders[0]![0] : null;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

async function writeJson(filePath: string, value: unknown): Promise<void> {
  const config = (await resolveConfig(filePath)) ?? {};
  const text = await format(JSON.stringify(value, null, 2), {
    ...config,
    parser: 'json',
    filepath: filePath,
  });
  writeFileSync(filePath, text);
}

function validate<N extends FixtureName>(name: N, fixture: FixtureOf<N>): void {
  const schema = FIXTURE_SCHEMAS[name];
  if (!Value.Check(schema, fixture)) {
    const first = Value.Errors(schema, fixture).First();
    throw new Error(
      `${name}: generated fixture is invalid at ${first?.path ?? '?'}: ${first?.message ?? '?'}`,
    );
  }
}

export async function main(): Promise<void> {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  mkdirSync(SCHEMA_DIR, { recursive: true });
  const fixtures = {
    'latlng-to-cell': latLngToCellCases(),
    'zoom-resolution': zoomResolutionCases(),
    'walk-paths': walkPaths(),
    'reckoning-weeks': reckoningWeeks(),
  } satisfies { [N in FixtureName]: FixtureOf<N> };
  for (const name of Object.keys(fixtures) as FixtureName[]) {
    validate(name, fixtures[name]);
    const file = join(FIXTURES_DIR, `${name}.json`);
    await writeJson(file, fixtures[name]);
    const schemaFile = join(SCHEMA_DIR, `${name}.schema.json`);
    await writeJson(schemaFile, {
      $schema: 'http://json-schema.org/draft-07/schema#',
      ...FIXTURE_SCHEMAS[name],
    });
    console.log(`wrote ${file} and ${schemaFile}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
