import { describe, expect, it } from 'vitest';
import { STANDING_STRENGTH_WEIGHT, computeStanding } from '../../src/modules/walks/standing.js';

describe('week standing read model (research.md R8)', () => {
  it("uses half of last reckoning's strength", () => {
    expect(STANDING_STRENGTH_WEIGHT).toBe(0.5);
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
