import { loadFixture } from '@nature/h3-fixtures';
import { applyWeeklyCap } from '@nature/territory-rules';
import { describe, expect, it } from 'vitest';
import { scoreSamples } from '../../src/modules/walks/finish.js';

const fixture = loadFixture('walk-paths');
const TOLERANCE_M = 0.5;

describe('scoreSamples (the pure half of finishWalk) over walk-paths.json', () => {
  for (const c of fixture.cases) {
    it(`${c.id}: acceptedSeqs, rejected, flags, distanceM ±0.5, hexMeters ±0.5`, () => {
      const scored = scoreSamples(c.input.samples, c.input.pedometerSteps);
      expect(scored.accepted.map((s) => s.seq)).toEqual(c.expected.acceptedSeqs);
      expect(scored.rejected).toEqual(c.expected.rejected);
      expect(scored.flags).toEqual(c.expected.flags);
      expect(scored.simplified).toHaveLength(c.expected.simplifiedPointCount);
      expect(Math.abs(scored.distanceM - c.expected.distanceM)).toBeLessThanOrEqual(TOLERANCE_M);
      expect(scored.hexes.map((h) => h.cell)).toEqual(c.expected.hexMeters.map((h) => h.cell));
      for (const want of c.expected.hexMeters) {
        const got = scored.hexes.find((h) => h.cell === want.cell)!;
        expect(Math.abs(got.meters - want.meters), want.cell).toBeLessThanOrEqual(TOLERANCE_M);
      }
      expect(scored.medianSpeedMps).toBeGreaterThanOrEqual(0);
      expect(scored.acceptedDurationS).toBeGreaterThanOrEqual(0);
    });
  }

  it('reports the median implied speed used by the flags', () => {
    const car = fixture.cases.find((c) => c.id === 'car-speed')!;
    const scored = scoreSamples(car.input.samples, car.input.pedometerSteps);
    expect(scored.medianSpeedMps).toBeGreaterThan(3.5);
    const walk = fixture.cases.find((c) => c.id === 'straight-line')!;
    expect(scoreSamples(walk.input.samples).medianSpeedMps).toBeLessThan(3.5);
  });

  it('scores nothing for fewer than two accepted samples and is not flagged', () => {
    expect(scoreSamples([])).toMatchObject({
      accepted: [],
      rejected: [],
      flags: [],
      simplified: [],
      distanceM: 0,
      hexes: [],
      medianSpeedMps: 0,
      acceptedDurationS: 0,
    });
    const one = scoreSamples([
      { seq: 0, ts: '2026-09-07T08:00:00Z', lat: 54.9, lon: 23.9, hAcc: 5, speed: 1 },
      { seq: 1, ts: '2026-09-07T08:00:05Z', lat: 54.9001, lon: 23.9, hAcc: 90, speed: 1 },
    ]);
    expect(one.accepted).toHaveLength(1);
    expect(one.rejected).toEqual([{ seq: 1, reason: 'accuracy' }]);
    expect(one.hexes).toEqual([]);
    expect(one.distanceM).toBe(0);
    expect(one.flags).toEqual([]);
  });
});

describe('weekly cap arithmetic as finishWalk applies it (research.md R5)', () => {
  const cap = (existingMeters: number, existingCapped: number, walkMeters: number) => {
    const [row] = applyWeeklyCap([
      { cell: '891f40d1a4fffff', factionId: 1, userId: 'u', meters: existingMeters + walkMeters },
    ]);
    return {
      total: row!.meters,
      capped: row!.cappedMeters,
      counted: row!.cappedMeters - existingCapped,
    };
  };

  it('counts everything below the cap', () => {
    expect(cap(0, 0, 812.3)).toEqual({ total: 812.3, capped: 812.3, counted: 812.3 });
    expect(cap(1000, 1000, 500)).toEqual({ total: 1500, capped: 1500, counted: 500 });
  });

  it('counts only the remainder at the cap and nothing beyond it', () => {
    expect(cap(1800, 1800, 500)).toEqual({ total: 2300, capped: 2000, counted: 200 });
    expect(cap(2300, 2000, 400)).toEqual({ total: 2700, capped: 2000, counted: 0 });
    expect(cap(0, 0, 5000)).toEqual({ total: 5000, capped: 2000, counted: 2000 });
  });
});
