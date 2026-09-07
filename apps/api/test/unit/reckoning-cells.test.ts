import { loadFixture, type ReckoningWeeksFixture } from '@nature/h3-fixtures';
import { RULES } from '@nature/territory-rules';
import { describe, expect, it } from 'vitest';
import {
  bonusesOf,
  reckonBatch,
  type CellInputs,
  type RawContribution,
} from '../../src/modules/territory/reckoning/cells.js';

const fixture: ReckoningWeeksFixture = loadFixture('reckoning-weeks');

/** One synthetic bonus user per faction, as the integration seeding does (research.md R19). */
function bonusUser(factionId: number): string {
  return `bonus-f${String(factionId)}`;
}

/** Builds the in-memory inputs of one fixture cell for one week from the previous week's expected state. */
function inputsFor(
  cell: ReckoningWeeksFixture['cells'][number],
  weekIndex: number,
  overrides: Partial<CellInputs> = {},
): CellInputs {
  const week = cell.weeks[weekIndex]!;
  const previous = weekIndex === 0 ? cell.initial : cell.weeks[weekIndex - 1]!.expected;
  const raw: RawContribution[] = week.contributions.map((c) => ({
    factionId: c.factionId,
    userId: c.userId,
    meters: c.meters,
    cappedMeters: Math.min(c.meters, RULES.WEEKLY_CAP_M_PER_PLAYER_PER_CELL),
    bonusMeters: 0,
  }));
  for (const b of week.bonuses) {
    raw.push({
      factionId: b.factionId,
      userId: bonusUser(b.factionId),
      meters: 0,
      cappedMeters: 0,
      bonusMeters: b.meters,
    });
  }
  return {
    cell: cell.cell,
    exists: weekIndex > 0 || previous.strengths.length > 0,
    owner: previous.owner,
    ownerSinceWeek: null,
    captainBefore: weekIndex === 0 ? null : cell.weeks[weekIndex - 1]!.expected.captain,
    lastReckonedWeek: weekIndex === 0 ? '2026-W34' : cell.weeks[weekIndex - 1]!.weekId,
    lastActivityWeek: null,
    strengths: previous.strengths,
    rawContributions: raw,
    ...overrides,
  };
}

describe('reckonBatch over reckoning-weeks.json (research.md R4, SC-001 in memory)', () => {
  for (const cell of fixture.cells) {
    for (const [weekIndex, week] of cell.weeks.entries()) {
      it(`${cell.id} ${week.weekId}`, () => {
        const batch = reckonBatch([inputsFor(cell, weekIndex)], week.weekId);
        expect(batch.skipped).toBe(0);
        expect(batch.capDrift).toBe(0);
        expect(batch.outcomes).toHaveLength(1);
        const outcome = batch.outcomes[0]!;
        expect(outcome.contributions.map((c) => ({ ...c }))).toEqual(
          week.expected.capped.map((c) => ({
            factionId: c.factionId,
            cappedMeters: c.cappedMeters,
            userId: c.userId,
          })),
        );
        expect(outcome.result.strengths.map((s) => s.factionId)).toEqual(
          week.expected.strengths.map((s) => s.factionId),
        );
        for (const [i, s] of outcome.result.strengths.entries()) {
          expect(s.strength).toBeCloseTo(week.expected.strengths[i]!.strength, 2);
        }
        expect(outcome.result.owner).toBe(week.expected.owner);
        expect(outcome.result.flipped).toBe(week.expected.flipped);
        expect(outcome.result.captain).toBe(week.expected.captain);
        if (week.expected.event) {
          expect(outcome.result.event).toEqual(week.expected.event);
        } else {
          expect(outcome.result.event).toBeUndefined();
        }
        expect(outcome.hadContributions).toBe(
          week.contributions.length > 0 || week.bonuses.length > 0,
        );
        expect(outcome.ownerSinceWeek).toBe(
          week.expected.flipped ? (week.expected.owner === null ? null : week.weekId) : null,
        );
      });
    }
  }

  it('names the faction-2 walkers with counted metres as beneficiaries of the cap-and-bonus W36 flip', () => {
    const cell = fixture.cells.find((c) => c.id === 'cap-and-bonus')!;
    const w36 = cell.weeks[1]!;
    expect(w36.expected.event).toEqual({ from: 1, to: 2 });
    const batch = reckonBatch([inputsFor(cell, 1)], w36.weekId);
    const expectedUsers = w36.expected.capped
      .filter((c) => c.factionId === 2 && c.cappedMeters > 0)
      .map((c) => c.userId)
      .sort();
    expect(expectedUsers.length).toBeGreaterThan(1);
    expect(batch.beneficiaries.map((b) => b.userId).sort()).toEqual(expectedUsers);
    expect(batch.beneficiaries.every((b) => b.factionId === 2 && b.cell === cell.cell)).toBe(true);
  });

  it('awards nothing for a flip to unclaimed and nothing to the losing faction', () => {
    const cell = fixture.cells.find((c) => c.id === 'incumbent-decays-below-min-no-challenger')!;
    const w36 = cell.weeks[1]!;
    expect(w36.expected.event).toEqual({ from: 1, to: null });
    const batch = reckonBatch([inputsFor(cell, 1)], w36.weekId);
    expect(batch.beneficiaries).toEqual([]);
  });

  it('skips a cell already reckoned for the week (second idempotency guard)', () => {
    const cell = fixture.cells[1]!;
    const inputs = inputsFor(cell, 0, { lastReckonedWeek: cell.weeks[0]!.weekId });
    const batch = reckonBatch([inputs, inputsFor(fixture.cells[2]!, 0)], cell.weeks[0]!.weekId);
    expect(batch.skipped).toBe(1);
    expect(batch.outcomes).toHaveLength(1);
    expect(batch.outcomes[0]?.cell).toBe(fixture.cells[2]!.cell);
  });

  it('cross-checks the stored capped metres and only warns on drift', () => {
    const cell = fixture.cells.find((c) => c.id === 'first-claim')!;
    const inputs = inputsFor(cell, 0);
    inputs.rawContributions[0]!.cappedMeters += 5;
    const warnings: unknown[] = [];
    const batch = reckonBatch([inputs], cell.weeks[0]!.weekId, {
      warn: (message, context) => warnings.push({ message, context }),
    });
    expect(batch.capDrift).toBe(1);
    expect(warnings).toHaveLength(1);
    expect(batch.outcomes[0]?.result.owner).toBe(cell.weeks[0]!.expected.owner);
  });

  it('sums bonuses per faction and ignores walking rows', () => {
    expect(
      bonusesOf([
        { factionId: 2, userId: 'a', meters: 100, cappedMeters: 100, bonusMeters: 0 },
        { factionId: 2, userId: 'b', meters: 0, cappedMeters: 0, bonusMeters: 300 },
        { factionId: 1, userId: 'c', meters: 0, cappedMeters: 0, bonusMeters: 200 },
        { factionId: 2, userId: 'd', meters: 0, cappedMeters: 0, bonusMeters: 200 },
      ]),
    ).toEqual([
      { factionId: 1, meters: 200 },
      { factionId: 2, meters: 500 },
    ]);
  });

  it('marks first-seen cells as new and keeps owner_since_week when nothing flips', () => {
    const cell = fixture.cells.find((c) => c.id === 'first-claim')!;
    const fresh = reckonBatch([inputsFor(cell, 0, { exists: false })], cell.weeks[0]!.weekId);
    expect(fresh.outcomes[0]?.isNew).toBe(true);
    expect(fresh.outcomes[0]?.ownerSinceWeek).toBe(cell.weeks[0]!.weekId);
    const kept = reckonBatch(
      [inputsFor(cell, 1, { ownerSinceWeek: '2026-W35' })],
      cell.weeks[1]!.weekId,
    );
    expect(kept.outcomes[0]?.isNew).toBe(false);
    expect(kept.outcomes[0]?.result.flipped).toBe(false);
    expect(kept.outcomes[0]?.ownerSinceWeek).toBe('2026-W35');
  });
});
