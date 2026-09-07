/**
 * Sample acceptance and walk flags (`docs/territory-rules.md` "Walk acceptance",
 * `plan.md` "Shared Rule Semantics" items 4-5).
 */
import { RULES } from './config.js';
import { haversineM } from './geo.js';
import type { AcceptResult, RejectedSample, Sample, WalkFlag } from './types.js';

/** Milliseconds since epoch of a sample's ISO timestamp; `NaN` when unparsable. */
export function sampleTimeMs(sample: Pick<Sample, 'ts'>): number {
  return Date.parse(sample.ts);
}

/**
 * Apply the sample filters in a fixed order (so both implementations reject a sample that fails
 * two checks for the same reason): timestamp not strictly after the last *accepted* sample ->
 * `non_monotonic`; `hAcc > 50` -> `accuracy`; `speed` present and `> 5` -> `speed`.
 * Samples are processed in ascending `seq` order regardless of input order.
 */
export function acceptSamples(samples: readonly Sample[]): AcceptResult {
  const sorted = samples.slice().sort((a, b) => a.seq - b.seq);
  const accepted: Sample[] = [];
  const rejected: RejectedSample[] = [];
  let lastTs = Number.NEGATIVE_INFINITY;
  for (const s of sorted) {
    const ts = sampleTimeMs(s);
    if (!(ts > lastTs)) {
      rejected.push({ seq: s.seq, reason: 'non_monotonic' });
    } else if (s.hAcc > RULES.MAX_SAMPLE_HACC_M) {
      rejected.push({ seq: s.seq, reason: 'accuracy' });
    } else if (s.speed !== undefined && s.speed !== null && s.speed > RULES.MAX_SAMPLE_SPEED_MPS) {
      rejected.push({ seq: s.seq, reason: 'speed' });
    } else {
      accepted.push(s);
      lastTs = ts;
    }
  }
  return { accepted, rejected };
}

/** Median of a non-empty list (mean of the two middle values for even counts). */
function median(values: readonly number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Walk-level flags over the *accepted* samples (raw, before simplification), reported in the
 * table's order: `teleport`, `speed`, `distance`, `no_steps`. Flags never remove samples.
 *
 * - `teleport`: implied speed between two consecutive accepted samples > 8 m/s
 * - `speed`: median implied speed > 3.5 m/s
 * - `distance`: raw accepted path > 30000 m or duration (first to last accepted) > 6 h
 * - `no_steps`: only when `pedometerSteps` is given, the path is > 500 m and steps/metre < 0.5
 */
export function walkFlags(accepted: readonly Sample[], pedometerSteps?: number | null): WalkFlag[] {
  const flags: WalkFlag[] = [];
  const impliedSpeeds: number[] = [];
  let distanceM = 0;
  for (let i = 1; i < accepted.length; i++) {
    const a = accepted[i - 1]!;
    const b = accepted[i]!;
    const d = haversineM(a, b);
    const dtS = (sampleTimeMs(b) - sampleTimeMs(a)) / 1000;
    distanceM += d;
    impliedSpeeds.push(d / dtS);
  }
  const first = accepted[0];
  const last = accepted[accepted.length - 1];
  const durationS = first && last ? (sampleTimeMs(last) - sampleTimeMs(first)) / 1000 : 0;

  if (impliedSpeeds.some((v) => v > RULES.TELEPORT_SPEED_MPS)) flags.push('teleport');
  if (impliedSpeeds.length > 0 && median(impliedSpeeds) > RULES.MAX_WALK_MEDIAN_SPEED_MPS) {
    flags.push('speed');
  }
  if (distanceM > RULES.MAX_WALK_DISTANCE_M || durationS > RULES.MAX_WALK_DURATION_S) {
    flags.push('distance');
  }
  if (
    pedometerSteps !== undefined &&
    pedometerSteps !== null &&
    distanceM > RULES.NO_STEPS_MIN_DISTANCE_M &&
    pedometerSteps / distanceM < RULES.MIN_STEPS_PER_M
  ) {
    flags.push('no_steps');
  }
  return flags;
}
