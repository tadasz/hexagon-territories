import { loadFixture, type ReckoningWeeksFixture } from '@nature/h3-fixtures';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { cellToBigInt } from '../../src/lib/h3.js';
import {
  OutOfOrderError,
  WeekNotEndedError,
} from '../../src/modules/territory/reckoning/errors.js';
import {
  expectedWeekId,
  runDueReckonings,
  runReckoning,
} from '../../src/modules/territory/reckoning/run.js';
import { weekEndUtc } from '../../src/modules/territory/weeks.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';
import { reckoningDeps, seedFixtureWeeks } from '../helpers/reckoning.js';

const fixture: ReckoningWeeksFixture = loadFixture('reckoning-weeks');
const [W35, W36, W37] = fixture.weeks as [string, string, string];

describeWithDb('runDueReckonings catches up missed weeks in order (FR-001, research.md R2)', () => {
  let h: IntegrationHarness;

  beforeAll(async () => {
    h = await createIntegrationHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  it('does nothing before any contribution exists', async () => {
    const deps = reckoningDeps(h.tdb, h.clock);
    expect(await runDueReckonings(deps, new Date('2026-09-14T00:00:00.000Z'))).toEqual([]);
    const { rows } = await h.tdb.pool.query('select 1 from reckonings');
    expect(rows).toEqual([]);
  });

  it('refuses a week out of sequence, a week that has not ended and answers the expected week', async () => {
    await seedFixtureWeeks(h.tdb, fixture);
    const deps = reckoningDeps(h.tdb, h.clock);
    // clock: Monday after W37 (2026-09-21), three weeks are due
    h.clock.set(new Date(weekEndUtc(W37).getTime() + 60_000));
    expect(await expectedWeekId(h.tdb.db, h.clock.now())).toBe(W35);
    await expect(runReckoning(deps, { weekId: W36 })).rejects.toMatchObject({
      name: 'OutOfOrderError',
      expectedWeekId: W35,
      code: 'RECKONING_OUT_OF_ORDER',
    });
    await expect(runReckoning(deps, { weekId: '2026-W38' })).rejects.toThrow(WeekNotEndedError);
    await expect(runReckoning(deps, { weekId: '2026-W99' })).rejects.toThrow(RangeError);
    // a week older than the first contribution week is out of sequence too (never reckoned)
    await expect(runReckoning(deps, { weekId: '2026-W34' })).rejects.toThrow(OutOfOrderError);
  });

  it('runs W35, W36 and W37 in order and applies decay once per week', async () => {
    const deps = reckoningDeps(h.tdb, h.clock);
    const results = await runDueReckonings(deps, h.clock.now());
    expect(results.map((r) => r.weekId)).toEqual([W35, W36, W37]);
    const { rows } = await h.tdb.pool.query<{ week_id: string; status: string }>(
      'select week_id, status from reckonings order by week_id',
    );
    expect(rows).toEqual([
      { week_id: W35, status: 'done' },
      { week_id: W36, status: 'done' },
      { week_id: W37, status: 'done' },
    ]);
    // first-claim: 800 → 600 → 700 across the three weeks; strengths decayed three times
    const cell = fixture.cells.find((c) => c.id === 'first-claim')!;
    const { rows: strengths } = await h.tdb.pool.query<{ strength: number }>(
      'select strength from hex_faction_strength where h3_r9 = $1 and faction_id = 1',
      [cellToBigInt(cell.cell).toString()],
    );
    expect(strengths[0]?.strength).toBeCloseTo(cell.weeks[2]!.expected.strengths[0]!.strength, 2);
    expect(await expectedWeekId(h.tdb.db, h.clock.now())).toBe('2026-W38');
  });

  it('is a no-op for a week older than the last completed one and runs nothing when up to date', async () => {
    const deps = reckoningDeps(h.tdb, h.clock);
    const stored = await runReckoning(deps, { weekId: W36 });
    expect(stored.status).toBe('done');
    expect(stored.resumed).toBe(false);
    expect(stored.hexesProcessed).toBe(fixture.cells.length);
    expect(await runDueReckonings(deps, h.clock.now())).toEqual([]);
    // the next Monday: exactly one more week (an empty one) becomes due
    h.clock.set(new Date(weekEndUtc('2026-W38').getTime()));
    const next = await runDueReckonings(deps, h.clock.now());
    expect(next.map((r) => r.weekId)).toEqual(['2026-W38']);
    expect(next[0]?.hexesProcessed).toBe(
      fixture.cells.filter((c) => c.weeks[2]!.expected.strengths.length > 0).length,
    );
  });
});
