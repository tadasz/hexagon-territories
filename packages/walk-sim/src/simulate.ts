import { haversineM, interpolate, type LatLng, type Sample } from '@nature/territory-rules';
import { bearingDeg, destination, round } from './geo.js';
import { gaussian, mulberry32 } from './random.js';
import { hasTimestamps, type Track, type TrackPoint } from './track.js';

/** Distortion and pacing options (specs/003-walk-tracking/data-model.md §4). */
export interface SimulateOptions {
  /** Resample at this constant pace (m/s); default: the track's timestamps, else 1.4. */
  speedMps?: number;
  /** Gaussian σ (metres) added to every sample's position, seeded; default 0. */
  jitterM?: number;
  /** Reported `hAcc` of every sample; default 8. */
  accuracyM?: number;
  /** Insert one 400 m jump (5 s) at the midpoint. */
  teleport?: boolean;
  /** Report 0 pedometer steps. */
  spoofNoSteps?: boolean;
  /** Steps per metre for the simulated pedometer; default 1.3. */
  stepsPerM?: number;
  /** Explicit pedometer total (overrides `stepsPerM` and the track hint). */
  pedometerSteps?: number;
  /** Seconds between samples; default 5. */
  sampleEveryS?: number;
  /** ISO timestamp of the first sample; default: the track's first timestamp or 2026-09-07T08:00:00Z. */
  startAt?: string;
  /** PRNG seed for jitter; default 20260907. */
  seed?: number;
  /**
   * Report the implied speed in `speed` (default, as a phone does) or hide it (`false`, as a
   * spoofed device would, so the walk-level flags are what stops a car). Overrides the track hint.
   */
  reportSpeed?: boolean;
}

export interface Simulated {
  samples: Sample[];
  /** `null` when the pedometer is unavailable (never in this simulator; `0` when spoofed). */
  pedometerSteps: number | null;
  /** Length of the undistorted resampled path in metres. */
  distanceM: number;
}

export const SIMULATE_DEFAULTS = {
  speedMps: 1.4,
  jitterM: 0,
  accuracyM: 8,
  stepsPerM: 1.3,
  sampleEveryS: 5,
  startAt: '2026-09-07T08:00:00.000Z',
  seed: 20260907,
  teleportM: 400,
} as const;

/** Metres of latitude per degree (small-offset conversion for jitter). */
const M_PER_DEG_LAT = 111_320;

interface Resampled {
  positions: LatLng[];
  elevations: (number | undefined)[];
  /** Milliseconds since epoch of each sample. */
  timesMs: number[];
}

function pointAlong(
  points: readonly TrackPoint[],
  cumulative: readonly number[],
  s: number,
): LatLng {
  let j = 0;
  while (j < cumulative.length - 2 && cumulative[j + 1]! < s) j += 1;
  const a = points[j]!;
  const b = points[Math.min(j + 1, points.length - 1)]!;
  const len = cumulative[j + 1]! - cumulative[j]!;
  const t = len > 0 ? Math.min(1, Math.max(0, (s - cumulative[j]!) / len)) : 0;
  return interpolate(a, b, t);
}

function elevationAlong(points: readonly TrackPoint[], cumulative: readonly number[], s: number) {
  let j = 0;
  while (j < cumulative.length - 2 && cumulative[j + 1]! < s) j += 1;
  const a = points[j]!;
  const b = points[Math.min(j + 1, points.length - 1)]!;
  if (a.ele === undefined || b.ele === undefined) return undefined;
  const len = cumulative[j + 1]! - cumulative[j]!;
  const t = len > 0 ? Math.min(1, Math.max(0, (s - cumulative[j]!) / len)) : 0;
  return a.ele + (b.ele - a.ele) * t;
}

function resampleByPace(track: Track, speedMps: number, dtS: number, startMs: number): Resampled {
  const points = track.points;
  const cumulative = [0];
  for (let i = 1; i < points.length; i += 1) {
    cumulative.push(cumulative[i - 1]! + haversineM(points[i - 1]!, points[i]!));
  }
  const total = cumulative[cumulative.length - 1]!;
  const step = speedMps * dtS;
  const count = step > 0 && total > 0 ? Math.floor(total / step + 1e-9) + 1 : 1;
  const out: Resampled = { positions: [], elevations: [], timesMs: [] };
  for (let k = 0; k < count; k += 1) {
    const s = Math.min(total, k * step);
    out.positions.push(pointAlong(points, cumulative, s));
    out.elevations.push(elevationAlong(points, cumulative, s));
    out.timesMs.push(startMs + k * dtS * 1000);
  }
  return out;
}

function resampleByTime(track: Track, dtS: number, startMs: number): Resampled {
  const points = track.points;
  const times = points.map((p) => Date.parse(p.ts as string));
  for (let i = 1; i < times.length; i += 1) {
    if (times[i]! < times[i - 1]!) throw new Error('track timestamps must not decrease');
  }
  const t0 = times[0]!;
  const span = times[times.length - 1]! - t0;
  const stepMs = dtS * 1000;
  const count = span > 0 ? Math.floor(span / stepMs + 1e-9) + 1 : 1;
  const out: Resampled = { positions: [], elevations: [], timesMs: [] };
  let j = 0;
  for (let k = 0; k < count; k += 1) {
    const tk = Math.min(t0 + k * stepMs, t0 + span);
    while (j < times.length - 2 && times[j + 1]! < tk) j += 1;
    const a = points[j]!;
    const b = points[Math.min(j + 1, points.length - 1)]!;
    const len = times[Math.min(j + 1, times.length - 1)]! - times[j]!;
    const t = len > 0 ? Math.min(1, Math.max(0, (tk - times[j]!) / len)) : 1;
    out.positions.push(interpolate(a, b, t));
    out.elevations.push(
      a.ele !== undefined && b.ele !== undefined ? a.ele + (b.ele - a.ele) * t : undefined,
    );
    out.timesMs.push(startMs + (tk - t0));
  }
  return out;
}

/**
 * Turns a track into the sample stream a phone would upload (plan.md Shared Semantics 1): one
 * sample every `sampleEveryS` seconds along the track at the given pace (or at the track's own
 * timestamps), `seq` from 0, then the requested distortions. Deterministic for a given seed.
 */
export function simulate(track: Track, options: SimulateOptions = {}): Simulated {
  if (track.points.length === 0) throw new Error('the track has no points');
  const dtS = options.sampleEveryS ?? SIMULATE_DEFAULTS.sampleEveryS;
  if (!(dtS > 0)) throw new RangeError('sampleEveryS must be positive');
  const byPace = options.speedMps !== undefined || !hasTimestamps(track);
  const startAt =
    options.startAt ?? (hasTimestamps(track) ? track.points[0]!.ts! : SIMULATE_DEFAULTS.startAt);
  const startMs = Date.parse(startAt);
  if (Number.isNaN(startMs)) throw new RangeError(`invalid startAt ${startAt}`);

  const base = byPace
    ? resampleByPace(track, options.speedMps ?? SIMULATE_DEFAULTS.speedMps, dtS, startMs)
    : resampleByTime(track, dtS, startMs);

  let distanceM = 0;
  const speeds: number[] = [];
  const courses: number[] = [];
  for (let i = 1; i < base.positions.length; i += 1) {
    const d = haversineM(base.positions[i - 1]!, base.positions[i]!);
    const dt = (base.timesMs[i]! - base.timesMs[i - 1]!) / 1000;
    distanceM += d;
    speeds.push(dt > 0 ? d / dt : 0);
    courses.push(bearingDeg(base.positions[i - 1]!, base.positions[i]!));
  }

  const rng = mulberry32(options.seed ?? SIMULATE_DEFAULTS.seed);
  const jitterM = options.jitterM ?? SIMULATE_DEFAULTS.jitterM;
  const positions = base.positions.map((p) => {
    if (!(jitterM > 0)) return p;
    const north = gaussian(rng) * jitterM;
    const east = gaussian(rng) * jitterM;
    return {
      lat: p.lat + north / M_PER_DEG_LAT,
      lon: p.lon + east / (M_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180)),
    };
  });
  if (options.teleport && positions.length >= 2) {
    const mid = Math.floor(positions.length / 2);
    for (let i = mid; i < positions.length; i += 1) {
      positions[i] = destination(positions[i]!, 0, SIMULATE_DEFAULTS.teleportM);
    }
  }

  const reportSpeed = options.reportSpeed ?? track.hints?.reportSpeed ?? true;
  const hAcc = options.accuracyM ?? SIMULATE_DEFAULTS.accuracyM;
  const samples: Sample[] = positions.map((p, i) => {
    const speed = speeds[Math.max(0, i - 1)];
    const course = courses[Math.max(0, i - 1)];
    const sample: Sample = {
      seq: i,
      ts: new Date(base.timesMs[i]!).toISOString(),
      lat: round(p.lat, 7),
      lon: round(p.lon, 7),
      hAcc,
      speed: reportSpeed && speed !== undefined ? round(speed, 2) : null,
    };
    if (course !== undefined) sample.course = Math.round(course) % 360;
    const ele = base.elevations[i];
    if (ele !== undefined) sample.alt = round(ele, 1);
    return sample;
  });

  const pedometerSteps = options.spoofNoSteps
    ? 0
    : (options.pedometerSteps ??
      track.hints?.pedometerSteps ??
      Math.round(distanceM * (options.stepsPerM ?? SIMULATE_DEFAULTS.stepsPerM)));

  return { samples, pedometerSteps, distanceM };
}

/**
 * The same samples with every timestamp moved by `deltaMs` (intervals, order and `seq` kept).
 * `replay` uses it to re-time a recorded track so it ends just before "now": the server clamps
 * `startedAt` to the last 12 hours and refuses an `endedAt` before it, so a track recorded on
 * another day would otherwise never finish.
 */
export function shiftSamples(samples: readonly Sample[], deltaMs: number): Sample[] {
  return samples.map((s) => ({ ...s, ts: new Date(Date.parse(s.ts) + deltaMs).toISOString() }));
}

/** Delta that puts the last sample at `endAt` (0 for an empty list). */
export function deltaToEndAt(samples: readonly Sample[], endAt: Date): number {
  const last = samples[samples.length - 1];
  return last ? endAt.getTime() - Date.parse(last.ts) : 0;
}
