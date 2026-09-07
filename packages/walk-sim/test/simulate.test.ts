import { haversineM } from '@nature/territory-rules';
import { describe, expect, it } from 'vitest';
import { expected } from '../src/expected.js';
import { deltaToEndAt, shiftSamples, simulate } from '../src/simulate.js';
import type { Track } from '../src/track.js';

/** ~1.2 km straight north-east, no timestamps. */
const STRAIGHT: Track = {
  name: 'straight',
  points: [
    { lat: 54.89, lon: 23.9 },
    { lat: 54.8938, lon: 23.9066 },
    { lat: 54.8976, lon: 23.9132 },
  ],
};

describe('simulate (pace mode)', () => {
  const sim = simulate(STRAIGHT, { speedMps: 1.4 });

  it('spaces samples 5 s apart with seq from 0 and monotonic timestamps', () => {
    expect(sim.samples.length).toBeGreaterThan(150);
    sim.samples.forEach((s, i) => {
      expect(s.seq).toBe(i);
      expect(s.hAcc).toBe(8);
      if (i > 0) {
        expect(Date.parse(s.ts) - Date.parse(sim.samples[i - 1]!.ts)).toBe(5_000);
        expect(haversineM(sim.samples[i - 1]!, s)).toBeCloseTo(7, 0);
        expect(s.speed).toBeCloseTo(1.4, 1);
      }
    });
    expect(sim.samples[0]?.ts).toBe('2026-09-07T08:00:00.000Z');
    expect(sim.distanceM).toBeGreaterThan(1_100);
    expect(sim.pedometerSteps).toBe(Math.round(sim.distanceM * 1.3));
  });

  it('is deterministic and yields no flags for a plain walk', () => {
    expect(simulate(STRAIGHT, { speedMps: 1.4 })).toEqual(sim);
    const exp = expected(sim.samples, sim.pedometerSteps);
    expect(exp.flags).toEqual([]);
    expect(exp.rejected).toEqual([]);
    expect(exp.hexes.length).toBeGreaterThanOrEqual(4);
  });

  it('applies jitter within a few σ and keeps the same count', () => {
    const jittered = simulate(STRAIGHT, { speedMps: 1.4, jitterM: 3, seed: 7 });
    expect(jittered.samples).toHaveLength(sim.samples.length);
    let moved = 0;
    jittered.samples.forEach((s, i) => {
      const d = haversineM(s, sim.samples[i]!);
      expect(d).toBeLessThan(20);
      if (d > 0.01) moved += 1;
    });
    expect(moved).toBeGreaterThan(sim.samples.length * 0.9);
    expect(simulate(STRAIGHT, { speedMps: 1.4, jitterM: 3, seed: 8 })).not.toEqual(jittered);
  });

  it('reports the requested accuracy and rejects when it exceeds 50 m', () => {
    const bad = simulate(STRAIGHT, { speedMps: 1.4, accuracyM: 80 });
    expect(bad.samples.every((s) => s.hAcc === 80)).toBe(true);
    const exp = expected(bad.samples, bad.pedometerSteps);
    expect(exp.acceptedSeqs).toEqual([]);
    expect(exp.rejected.every((r) => r.reason === 'accuracy')).toBe(true);
    expect(exp.hexes).toEqual([]);
  });

  it('teleport inserts one 400 m jump at the midpoint and flags the walk', () => {
    const tele = simulate(STRAIGHT, { speedMps: 1.4, teleport: true });
    const mid = Math.floor(tele.samples.length / 2);
    expect(haversineM(tele.samples[mid - 1]!, tele.samples[mid]!)).toBeCloseTo(407, -1);
    expect(haversineM(tele.samples[mid]!, sim.samples[mid]!)).toBeCloseTo(400, 0);
    expect(expected(tele.samples, tele.pedometerSteps).flags).toEqual(['teleport']);
  });

  it('spoof-no-steps reports 0 steps and flags no_steps over 500 m', () => {
    const spoofed = simulate(STRAIGHT, { speedMps: 1.4, spoofNoSteps: true });
    expect(spoofed.pedometerSteps).toBe(0);
    expect(expected(spoofed.samples, spoofed.pedometerSteps).flags).toEqual(['no_steps']);
    expect(simulate(STRAIGHT, { speedMps: 1.4, pedometerSteps: 42 }).pedometerSteps).toBe(42);
  });

  it('a car at 20 m/s is dropped by the sample filter unless the speed is hidden', () => {
    const honest = simulate(STRAIGHT, { speedMps: 20 });
    const honestExp = expected(honest.samples, honest.pedometerSteps);
    expect(honestExp.rejected.length).toBeGreaterThan(0);
    expect(honestExp.rejected.every((r) => r.reason === 'speed')).toBe(true);

    const hidden = simulate(STRAIGHT, { speedMps: 20, reportSpeed: false, pedometerSteps: 10 });
    expect(hidden.samples.every((s) => s.speed === null)).toBe(true);
    expect(expected(hidden.samples, hidden.pedometerSteps).flags).toEqual([
      'teleport',
      'speed',
      'no_steps',
    ]);

    const hinted = simulate(
      { ...STRAIGHT, hints: { reportSpeed: false, pedometerSteps: 10 } },
      { speedMps: 20 },
    );
    expect(hinted.samples).toEqual(hidden.samples);
    expect(hinted.pedometerSteps).toBe(10);
  });

  it('honours startAt and sampleEveryS', () => {
    const s = simulate(STRAIGHT, {
      speedMps: 1.4,
      startAt: '2026-09-06T23:50:00Z',
      sampleEveryS: 10,
    });
    expect(s.samples[0]?.ts).toBe('2026-09-06T23:50:00.000Z');
    expect(Date.parse(s.samples[1]!.ts) - Date.parse(s.samples[0]!.ts)).toBe(10_000);
    expect(s.samples.length).toBe(Math.floor(sim.samples.length / 2) + 1);
  });

  it('handles degenerate tracks', () => {
    const one = simulate({ name: 'one', points: [{ lat: 1, lon: 2 }] });
    expect(one.samples).toHaveLength(1);
    expect(one.samples[0]).toMatchObject({ seq: 0, lat: 1, lon: 2, speed: null });
    expect(one.distanceM).toBe(0);
    expect(() => simulate({ name: 'none', points: [] })).toThrow(/no points/);
    expect(() => simulate(STRAIGHT, { sampleEveryS: 0 })).toThrow(RangeError);
  });
});

describe('simulate (timestamp mode)', () => {
  const timed: Track = {
    name: 'timed',
    points: [
      { lat: 54.89, lon: 23.9, ts: '2026-09-07T09:00:00Z', ele: 50 },
      { lat: 54.8909, lon: 23.9, ts: '2026-09-07T09:01:00Z', ele: 60 },
      { lat: 54.8909, lon: 23.9015, ts: '2026-09-07T09:02:10Z', ele: 60 },
    ],
  };

  it('resamples along the track by time and keeps the track clock', () => {
    const sim = simulate(timed);
    expect(sim.samples[0]?.ts).toBe('2026-09-07T09:00:00.000Z');
    expect(sim.samples).toHaveLength(27); // 130 s / 5 s + 1
    expect(sim.samples[12]?.lat).toBeCloseTo(54.8909, 4);
    expect(sim.samples[12]?.alt).toBeCloseTo(60, 0);
    expect(sim.samples[6]?.alt).toBeCloseTo(55, 0);
    expect(sim.samples[26]?.lon).toBeCloseTo(23.9015, 4);
    expect(sim.samples[1]?.speed).toBeCloseTo(100 / 60, 1);
    expect(sim.samples[1]?.course).toBe(0);
    expect(sim.samples[20]?.course).toBe(90);
  });

  it('prefers a constant pace when speedMps is given and rejects decreasing timestamps', () => {
    const paced = simulate(timed, { speedMps: 1 });
    expect(paced.samples.length).toBeGreaterThan(27);
    expect(paced.samples[0]?.ts).toBe('2026-09-07T09:00:00.000Z');
    expect(() =>
      simulate({
        name: 'bad',
        points: [
          { lat: 1, lon: 1, ts: '2026-09-07T09:00:10Z' },
          { lat: 1, lon: 1.001, ts: '2026-09-07T09:00:00Z' },
        ],
      }),
    ).toThrow(/decrease/);
  });
});

describe('shiftSamples / deltaToEndAt', () => {
  it('moves every timestamp by the same delta and keeps everything else', () => {
    const sim = simulate(STRAIGHT, { speedMps: 1.4 });
    const endAt = new Date('2026-09-08T12:00:00.000Z');
    const delta = deltaToEndAt(sim.samples, endAt);
    const shifted = shiftSamples(sim.samples, delta);
    expect(shifted[shifted.length - 1]?.ts).toBe(endAt.toISOString());
    expect(Date.parse(shifted[1]!.ts) - Date.parse(shifted[0]!.ts)).toBe(5_000);
    expect(shifted.map((s) => [s.seq, s.lat, s.lon, s.speed])).toEqual(
      sim.samples.map((s) => [s.seq, s.lat, s.lon, s.speed]),
    );
    expect(expected(shifted, sim.pedometerSteps)).toEqual(
      expected(sim.samples, sim.pedometerSteps),
    );
    expect(deltaToEndAt([], endAt)).toBe(0);
    expect(shiftSamples([], 5)).toEqual([]);
  });
});
