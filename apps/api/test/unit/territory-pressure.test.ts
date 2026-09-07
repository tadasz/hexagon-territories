import { loadFixture } from '@nature/h3-fixtures';
import { RULES } from '@nature/territory-rules';
import { describe, expect, it } from 'vitest';
import { contestedFor, leaderOf, pressureOf } from '../../src/modules/territory/pressure.js';

describe('pressure read model (research.md R8, Shared Semantics 9)', () => {
  it('picks the highest score, breaks ties by the lowest faction id and answers null for nothing', () => {
    expect(
      leaderOf(
        new Map([
          [1, 812.3],
          [2, 1500],
        ]),
      ),
    ).toBe(2);
    expect(
      leaderOf(
        new Map([
          [3, 100],
          [2, 100],
        ]),
      ),
    ).toBe(2);
    expect(leaderOf(new Map([[1, 42]]))).toBe(1);
    expect(leaderOf(new Map())).toBeNull();
    expect(
      leaderOf(
        new Map([
          [1, 0],
          [2, 0],
        ]),
      ),
    ).toBeNull();
    expect(
      leaderOf(
        new Map([
          [1, -5],
          [2, 0],
        ]),
      ),
    ).toBeNull();
  });

  it('marks a cell contested only when the leader exists and differs from the owner', () => {
    expect(contestedFor(1, 2)).toBe(true);
    expect(contestedFor(null, 2)).toBe(true);
    expect(contestedFor(1, 1)).toBe(false);
    expect(contestedFor(1, null)).toBe(false);
    expect(contestedFor(null, null)).toBe(false);
  });

  it('scores strength × DECAY + capped metres + bonuses per faction, sorted by faction id', () => {
    const pressure = pressureOf([
      { factionId: 2, strength: 1000, cappedMeters: 100, bonusMeters: 0 },
      { factionId: 1, strength: 0, cappedMeters: 400, bonusMeters: 300 },
    ]);
    expect(pressure.factions.map((f) => f.factionId)).toEqual([1, 2]);
    expect(pressure.factions[0]?.score).toBe(700);
    expect(pressure.factions[1]?.score).toBe(1000 * RULES.DECAY + 100);
    expect(pressure.leader).toBe(1);
    expect([...pressure.scores.entries()]).toEqual([
      [1, 700],
      [2, 600],
    ]);
  });

  it('shows the hysteresis-holds fixture cell as contested after W35 with the W36 contributions', () => {
    const fixture = loadFixture('reckoning-weeks');
    const cell = fixture.cells.find((c) => c.id === 'hysteresis-holds');
    expect(cell).toBeDefined();
    const w35 = cell!.weeks[0]!;
    const w36 = cell!.weeks[1]!;
    // state after W35: faction 1 owns; the W36 contributions and bonuses are "this week's" pressure
    const rows = w35.expected.strengths.map((s) => ({
      factionId: s.factionId,
      strength: s.strength,
      cappedMeters: w36.contributions
        .filter((c) => c.factionId === s.factionId)
        .reduce((sum, c) => sum + Math.min(c.meters, RULES.WEEKLY_CAP_M_PER_PLAYER_PER_CELL), 0),
      bonusMeters: w36.bonuses
        .filter((b) => b.factionId === s.factionId)
        .reduce((sum, b) => sum + b.meters, 0),
    }));
    const pressure = pressureOf(rows);
    expect(w35.expected.owner).toBe(1);
    expect(pressure.leader).toBe(2);
    expect(contestedFor(w35.expected.owner, pressure.leader)).toBe(true);
    // ... and the reckoning of W36 still leaves faction 1 the owner (hysteresis holds)
    expect(w36.expected.owner).toBe(1);
    expect(w36.expected.flipped).toBe(false);
  });
});
