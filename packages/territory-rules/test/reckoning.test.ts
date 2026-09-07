import { loadFixture } from '@nature/h3-fixtures';
import { describe, expect, it } from 'vitest';
import {
  RULES,
  applyWeeklyCap,
  reckonWeek,
  type Contribution,
  type FactionStrength,
  type ReckonInput,
  type ReckonResult,
} from '../src/index.js';

const fixture = loadFixture('reckoning-weeks');
const STRENGTH_TOLERANCE = 0.01;

function expectStrengths(
  actual: FactionStrength[],
  expected: FactionStrength[],
  label: string,
): void {
  expect(
    actual.map((s) => s.factionId),
    `${label}: faction ids`,
  ).toEqual(expected.map((s) => s.factionId));
  for (const e of expected) {
    const a = actual.find((s) => s.factionId === e.factionId)!;
    expect(
      Math.abs(a.strength - e.strength),
      `${label}: faction ${e.factionId} strength ${a.strength} vs ${e.strength}`,
    ).toBeLessThanOrEqual(STRENGTH_TOLERANCE);
  }
}

function reckonFixtureWeek(
  cell: string,
  state: { owner: number | null; strengths: FactionStrength[] },
  week: (typeof fixture.cells)[number]['weeks'][number],
): { capped: ReturnType<typeof applyWeeklyCap>; result: ReckonResult } {
  const raw: Contribution[] = week.contributions.map((c) => ({ cell, ...c }));
  const capped = applyWeeklyCap(raw);
  const input: ReckonInput = {
    cell,
    owner: state.owner,
    strengths: state.strengths,
    contributions: capped.map((c) => ({
      factionId: c.factionId,
      userId: c.userId,
      cappedMeters: c.cappedMeters,
    })),
    bonuses: week.bonuses.map((b) => ({ factionId: b.factionId, meters: b.meters })),
  };
  return { capped, result: reckonWeek(input) };
}

describe('reckoning-weeks.json', () => {
  it('lists every ownership-table case id in its description', () => {
    for (const id of [
      'no-faction-reaches-min',
      'first-claim',
      'challenger-beats-hysteresis',
      'hysteresis-holds',
      'incumbent-decays-below-min-no-challenger',
      'exact-tie-incumbent-keeps',
      'exact-tie-no-incumbent',
      'cap-and-bonus',
    ]) {
      expect(fixture.description).toContain(id);
      expect(fixture.cells.map((c) => c.id)).toContain(id);
    }
  });

  for (const cell of fixture.cells) {
    describe(`${fixture.name}: ${cell.id}`, () => {
      // Replay week by week from each week's *fixture* initial state (week N+1 initial = week N expected)
      let state = cell.initial;
      for (const week of cell.weeks) {
        const initial = state;
        const { capped, result } = reckonFixtureWeek(cell.cell, initial, week);
        it(`${week.weekId}: cap`, () => {
          expect(
            capped.map((c) => ({
              factionId: c.factionId,
              userId: c.userId,
              cappedMeters: c.cappedMeters,
            })),
          ).toEqual(week.expected.capped);
        });
        it(`${week.weekId}: strengths ±${STRENGTH_TOLERANCE}`, () => {
          expectStrengths(result.strengths, week.expected.strengths, `${cell.id} ${week.weekId}`);
        });
        it(`${week.weekId}: owner ${String(week.expected.owner)}, flipped ${String(week.expected.flipped)}`, () => {
          expect(result.owner).toBe(week.expected.owner);
          expect(result.flipped).toBe(week.expected.flipped);
          expect(result.event).toEqual(week.expected.event);
          expect(result.captain).toBe(week.expected.captain);
        });
        state = { owner: week.expected.owner, strengths: week.expected.strengths };
      }

      it('chaining actual results reproduces the same owners', () => {
        let chained = cell.initial;
        for (const week of cell.weeks) {
          const { result } = reckonFixtureWeek(cell.cell, chained, week);
          expect(result.owner, `${cell.id} ${week.weekId}`).toBe(week.expected.owner);
          chained = { owner: result.owner, strengths: result.strengths };
        }
      });
    });
  }
});

describe('applyWeeklyCap unit cases', () => {
  it('sums per (cell, faction, user) and caps at the weekly cap', () => {
    const rows = applyWeeklyCap([
      { cell: 'b', factionId: 1, userId: 'u2', meters: 100 },
      { cell: 'a', factionId: 1, userId: 'u1', meters: 1500 },
      { cell: 'a', factionId: 1, userId: 'u1', meters: 900 },
      { cell: 'a', factionId: 2, userId: 'u1', meters: 50 },
    ]);
    expect(rows).toEqual([
      {
        cell: 'a',
        factionId: 1,
        userId: 'u1',
        meters: 2400,
        cappedMeters: RULES.WEEKLY_CAP_M_PER_PLAYER_PER_CELL,
      },
      { cell: 'a', factionId: 2, userId: 'u1', meters: 50, cappedMeters: 50 },
      { cell: 'b', factionId: 1, userId: 'u2', meters: 100, cappedMeters: 100 },
    ]);
    expect(applyWeeklyCap([])).toEqual([]);
  });
});

describe('reckonWeek unit cases', () => {
  const base: ReckonInput = {
    cell: 'x',
    owner: null,
    strengths: [],
    contributions: [],
    bonuses: [],
  };

  it('decays, drops factions below 0.001 and sorts by faction id', () => {
    const r = reckonWeek({
      ...base,
      owner: 2,
      strengths: [
        { factionId: 3, strength: 0.001 },
        { factionId: 2, strength: 1000 },
      ],
    });
    expect(r.strengths).toEqual([{ factionId: 2, strength: 500 }]);
    expect(r.owner).toBe(2); // exactly MIN_STRENGTH still holds
    expect(r.flipped).toBe(false);
    expect(r).not.toHaveProperty('event');
  });

  it('bonuses count toward strength but not toward the captain', () => {
    const r = reckonWeek({
      ...base,
      contributions: [{ factionId: 1, cappedMeters: 100, userId: 'walker' }],
      bonuses: [{ factionId: 1, meters: 450 }],
    });
    expect(r.owner).toBe(1);
    expect(r.captain).toBe('walker');
    const bonusOnly = reckonWeek({ ...base, bonuses: [{ factionId: 1, meters: 500 }] });
    expect(bonusOnly.owner).toBe(1);
    expect(bonusOnly.captain).toBeNull();
  });

  it('captain is the top contributor of the owning faction, ties by userId', () => {
    const r = reckonWeek({
      ...base,
      contributions: [
        { factionId: 1, cappedMeters: 400, userId: 'zed' },
        { factionId: 1, cappedMeters: 400, userId: 'amy' },
        { factionId: 2, cappedMeters: 300, userId: 'other' },
        { factionId: 1, cappedMeters: 100 },
      ],
    });
    expect(r.owner).toBe(1);
    expect(r.captain).toBe('amy');
  });

  it('hysteresis boundary: exactly 1.10 x incumbent flips, just below holds', () => {
    const at = reckonWeek({
      ...base,
      owner: 1,
      strengths: [{ factionId: 1, strength: 2000 }],
      contributions: [{ factionId: 2, cappedMeters: 1100 }],
    });
    expect(at.owner).toBe(2);
    expect(at.event).toEqual({ from: 1, to: 2 });
    const below = reckonWeek({
      ...base,
      owner: 1,
      strengths: [{ factionId: 1, strength: 2000 }],
      contributions: [{ factionId: 2, cappedMeters: 1099.99 }],
    });
    expect(below.owner).toBe(1);
    expect(below.flipped).toBe(false);
  });

  it('a challenger below MIN_STRENGTH never takes a cell, even if the incumbent is weaker', () => {
    const r = reckonWeek({
      ...base,
      owner: 1,
      strengths: [{ factionId: 1, strength: 600 }],
      contributions: [{ factionId: 2, cappedMeters: 499 }],
    });
    expect(r.owner).toBeNull(); // incumbent 300 < 500, challenger 499 < 500
    expect(r.event).toEqual({ from: 1, to: null });
  });

  it('an incumbent absent from the strengths counts as zero', () => {
    const r = reckonWeek({
      ...base,
      owner: 3,
      contributions: [{ factionId: 1, cappedMeters: 500 }],
    });
    expect(r.owner).toBe(1);
    expect(r.event).toEqual({ from: 3, to: 1 });
  });

  it('a tie at the top between two challengers keeps a holding incumbent', () => {
    const r = reckonWeek({
      ...base,
      owner: 1,
      strengths: [{ factionId: 1, strength: 1200 }],
      contributions: [
        { factionId: 2, cappedMeters: 900 },
        { factionId: 3, cappedMeters: 900 },
      ],
    });
    expect(r.owner).toBe(1);
  });

  it('does not mutate its input', () => {
    const input: ReckonInput = {
      ...base,
      strengths: [{ factionId: 1, strength: 1000 }],
      contributions: [{ factionId: 1, cappedMeters: 10 }],
    };
    const snapshot = structuredClone(input);
    reckonWeek(input);
    expect(input).toEqual(snapshot);
  });
});
