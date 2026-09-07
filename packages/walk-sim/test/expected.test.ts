import { loadFixture } from '@nature/h3-fixtures';
import { describe, expect, it } from 'vitest';
import { expected } from '../src/expected.js';

const fixture = loadFixture('walk-paths');
const TOLERANCE_M = 0.5;

describe('expected() reproduces walk-paths.json (the oracle is validated against the fixtures)', () => {
  for (const c of fixture.cases) {
    it(c.id, () => {
      const exp = expected(c.input.samples, c.input.pedometerSteps);
      expect(exp.acceptedSeqs).toEqual(c.expected.acceptedSeqs);
      expect(exp.rejected).toEqual(c.expected.rejected);
      expect(exp.flags).toEqual(c.expected.flags);
      expect(exp.simplifiedPointCount).toBe(c.expected.simplifiedPointCount);
      expect(Math.abs(exp.distanceM - c.expected.distanceM)).toBeLessThanOrEqual(TOLERANCE_M);
      expect(exp.hexes.map((h) => h.cell)).toEqual(c.expected.hexMeters.map((h) => h.cell));
      for (const want of c.expected.hexMeters) {
        const got = exp.hexes.find((h) => h.cell === want.cell)!;
        expect(Math.abs(got.meters - want.meters), want.cell).toBeLessThanOrEqual(TOLERANCE_M);
      }
    });
  }

  it('answers zeros for fewer than two accepted samples', () => {
    expect(expected([])).toEqual({
      acceptedSeqs: [],
      rejected: [],
      flags: [],
      distanceM: 0,
      simplifiedPointCount: 0,
      hexes: [],
    });
    const one = expected([{ seq: 0, ts: '2026-09-07T08:00:00Z', lat: 54.9, lon: 23.9, hAcc: 5 }]);
    expect(one).toMatchObject({
      acceptedSeqs: [0],
      distanceM: 0,
      simplifiedPointCount: 0,
      hexes: [],
    });
  });
});
