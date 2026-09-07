import { RULES } from '@nature/territory-rules';
import { describe, expect, it } from 'vitest';
import { leaderOf, pressureOf } from '../../src/modules/territory/pressure.js';
import { computeStanding } from '../../src/modules/walks/standing.js';

describe('week standing read model (research.md R8)', () => {
  it("uses the territory module's pressure (strength × DECAY) instead of a local weight", () => {
    // feature 004 (T012): the weight lives in RULES.DECAY, read by pressureOf
    const pressure = pressureOf([
      { factionId: 2, strength: 3000, cappedMeters: 0, bonusMeters: 0 },
    ]);
    expect(pressure.scores.get(2)).toBe(3000 * RULES.DECAY);
    expect(RULES.DECAY).toBe(0.5);
  });

  it('agrees with leaderOf(pressureScores) for the same rows', () => {
    const rows = [
      { factionId: 1, strength: 100, cappedMeters: 50, bonusMeters: 0 },
      { factionId: 2, strength: 3000, cappedMeters: 0, bonusMeters: 0 },
      { factionId: 3, strength: 0, cappedMeters: 400, bonusMeters: 300 },
    ];
    const pressure = pressureOf(rows);
    const standing = computeStanding(
      pressure.factions.map((f) => ({ factionId: f.factionId, score: f.score })),
      1,
      2,
    );
    expect(standing.leader).toBe(leaderOf(pressure.scores));
    expect(standing.leader).toBe(2);
    expect(standing.myFactionShare).toBeCloseTo(100 / (100 + 1500 + 700), 3);
  });

  it("picks the highest score as leader and the caller's share of the total", () => {
    const standing = computeStanding(
      [
        { factionId: 1, score: 812.3 },
        { factionId: 2, score: 1500 },
      ],
      1,
      null,
    );
    expect(standing).toEqual({ leader: 2, myFactionShare: 0.351, owner: null });
  });

  it('breaks ties by the lowest faction id', () => {
    expect(
      computeStanding(
        [
          { factionId: 3, score: 100 },
          { factionId: 2, score: 100 },
        ],
        3,
        2,
      ),
    ).toEqual({ leader: 2, myFactionShare: 0.5, owner: 2 });
  });

  it('answers leader null and share 0 when every score is zero or there are none', () => {
    expect(computeStanding([], 1, null)).toEqual({ leader: null, myFactionShare: 0, owner: null });
    expect(
      computeStanding(
        [
          { factionId: 1, score: 0 },
          { factionId: 2, score: 0 },
        ],
        1,
        3,
      ),
    ).toEqual({ leader: null, myFactionShare: 0, owner: 3 });
  });

  it('rounds the share to three decimals and clamps to [0, 1]', () => {
    expect(computeStanding([{ factionId: 1, score: 1 }], 1, null).myFactionShare).toBe(1);
    expect(
      computeStanding(
        [
          { factionId: 1, score: 1 },
          { factionId: 2, score: 2 },
        ],
        1,
        null,
      ).myFactionShare,
    ).toBe(0.333);
    expect(computeStanding([{ factionId: 1, score: 1 }], null, null).myFactionShare).toBe(0);
    expect(computeStanding([{ factionId: 1, score: -5 }], 1, null).leader).toBeNull();
  });

  it('never writes ownership: owner is passed through as read', () => {
    expect(computeStanding([{ factionId: 1, score: 9999 }], 1, 2).owner).toBe(2);
  });
});
