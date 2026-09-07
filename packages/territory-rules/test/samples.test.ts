import { loadFixture } from '@nature/h3-fixtures';
import { describe, expect, it } from 'vitest';
import { RULES, acceptSamples, walkFlags, type Sample } from '../src/index.js';

const fixture = loadFixture('walk-paths');

describe('walk-paths.json: acceptSamples', () => {
  for (const c of fixture.cases) {
    it(`${fixture.name}: ${c.id} accepts ${c.expected.acceptedSeqs.length} and rejects ${c.expected.rejected.length}`, () => {
      const { accepted, rejected } = acceptSamples(c.input.samples);
      expect(accepted.map((s) => s.seq)).toEqual(c.expected.acceptedSeqs);
      expect(rejected).toEqual(c.expected.rejected);
    });
  }
});

describe('walk-paths.json: walkFlags', () => {
  for (const c of fixture.cases) {
    it(`${fixture.name}: ${c.id} flags ${JSON.stringify(c.expected.flags)}`, () => {
      const { accepted } = acceptSamples(c.input.samples);
      expect(walkFlags(accepted, c.input.pedometerSteps)).toEqual(c.expected.flags);
    });
  }

  it('teleport and car-speed report exactly their flags', () => {
    const byId = new Map(fixture.cases.map((c) => [c.id, c]));
    expect(byId.get('teleport')?.expected.flags).toEqual(['teleport']);
    expect(byId.get('car-speed')?.expected.flags).toEqual(['teleport', 'speed', 'no_steps']);
  });
});

/** Straight north walk: `n` samples `spacingM` apart every `stepS` seconds. */
function walk(n: number, spacingM: number, stepS: number, extra: Partial<Sample> = {}): Sample[] {
  const t0 = Date.parse('2026-09-07T08:00:00Z');
  const degPerM = 1 / 111_195; // ~ metres per degree of latitude on the 6371008.8 m sphere
  return Array.from({ length: n }, (_, i) => ({
    seq: i,
    ts: new Date(t0 + i * stepS * 1000).toISOString(),
    lat: 54.9 + i * spacingM * degPerM,
    lon: 23.9,
    hAcc: 8,
    speed: 1.4,
    ...extra,
  }));
}

describe('acceptSamples unit rules', () => {
  it('applies the checks in the fixed order non_monotonic, accuracy, speed', () => {
    const s = walk(4, 7, 5);
    s[1] = { ...s[1]!, hAcc: 80, speed: 9 }; // fails accuracy and speed -> accuracy wins
    s[2] = { ...s[2]!, ts: s[0]!.ts, hAcc: 80 }; // fails monotonic and accuracy -> non_monotonic wins
    const { accepted, rejected } = acceptSamples(s);
    expect(accepted.map((x) => x.seq)).toEqual([0, 3]);
    expect(rejected).toEqual([
      { seq: 1, reason: 'accuracy' },
      { seq: 2, reason: 'non_monotonic' },
    ]);
  });

  it('compares timestamps with the last accepted sample, not the last seen one', () => {
    const s = walk(4, 7, 5);
    s[1] = { ...s[1]!, ts: '2026-09-07T09:00:00Z', hAcc: 80 }; // rejected for accuracy, far in the future
    const { accepted } = acceptSamples(s);
    expect(accepted.map((x) => x.seq)).toEqual([0, 2, 3]); // seq 2 is still monotonic vs seq 0
  });

  it('treats equal timestamps as non-monotonic and sorts by seq', () => {
    const s = walk(3, 7, 5);
    s[2] = { ...s[2]!, ts: s[1]!.ts };
    const { accepted, rejected } = acceptSamples([s[2], s[0]!, s[1]!]);
    expect(accepted.map((x) => x.seq)).toEqual([0, 1]);
    expect(rejected).toEqual([{ seq: 2, reason: 'non_monotonic' }]);
  });

  it('thresholds are strict: exactly 50 m and exactly 5 m/s are accepted', () => {
    const s = walk(2, 7, 5, { hAcc: RULES.MAX_SAMPLE_HACC_M, speed: RULES.MAX_SAMPLE_SPEED_MPS });
    expect(acceptSamples(s).rejected).toEqual([]);
  });

  it('null or absent speed is unknown, not a rejection', () => {
    const s = walk(2, 7, 5, { speed: null });
    delete s[1]!.speed;
    expect(acceptSamples(s).accepted).toHaveLength(2);
  });
});

describe('walkFlags unit rules', () => {
  it('reports nothing for an empty or single-sample walk', () => {
    expect(walkFlags([])).toEqual([]);
    expect(walkFlags(walk(1, 7, 5), 0)).toEqual([]);
  });

  it('flags distance for a walk longer than 30 km', () => {
    expect(walkFlags(walk(4501, 7, 5))).toEqual(['distance']); // 31.5 km at 1.4 m/s
  });

  it('flags distance for a walk longer than 6 h even when short', () => {
    expect(walkFlags(walk(3, 1, 12000))).toEqual(['distance']); // 24000 s > 6 h
    expect(walkFlags(walk(3, 1, 10000))).toEqual([]); // 20000 s
  });

  it('flags no_steps only with a pedometer value and over 500 m', () => {
    const long = walk(100, 7, 5); // 693 m
    expect(walkFlags(long)).toEqual([]);
    expect(walkFlags(long, null)).toEqual([]);
    expect(walkFlags(long, 100)).toEqual(['no_steps']);
    expect(walkFlags(long, 400)).toEqual([]); // 0.58 steps/m
    const short = walk(60, 7, 5); // 413 m
    expect(walkFlags(short, 0)).toEqual([]);
  });

  it('flags speed on the median, teleport on any segment, in table order', () => {
    const jog = walk(20, 20, 5); // 4 m/s median
    expect(walkFlags(jog)).toEqual(['speed']);
    const one = walk(20, 7, 5);
    one[10] = { ...one[10]!, lat: one[10]!.lat + 0.005 }; // ~550 m jump in 5 s
    expect(walkFlags(one)).toEqual(['teleport']);
    const car = walk(40, 75, 5, { speed: null });
    expect(walkFlags(car, 10)).toEqual(['teleport', 'speed', 'no_steps']);
  });

  it('median of an even number of segments is the mean of the middle two', () => {
    const s = walk(3, 7, 5);
    s[2] = { ...s[2]!, lat: s[1]!.lat + 30 / 111_195 }; // speeds 1.4 and 6 -> median 3.7 > 3.5
    expect(walkFlags(s)).toEqual(['speed']);
  });
});
