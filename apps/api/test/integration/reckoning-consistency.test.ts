import { loadFixture, type ReckoningWeeksFixture } from '@nature/h3-fixtures';
import { cellToParent } from 'h3-js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { runConsistency } from '../../src/jobs/reckoning-consistency.js';
import { cellToBigInt } from '../../src/lib/h3.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';
import {
  holdAdvisoryLock,
  reckoningDeps,
  runFixtureWeek,
  seedFixtureWeeks,
} from '../helpers/reckoning.js';

const fixture: ReckoningWeeksFixture = loadFixture('reckoning-weeks');

describeWithDb('reckoning.consistency detects and repairs parent drift (FR-016, SC-006)', () => {
  let h: IntegrationHarness;
  const firstClaim = fixture.cells.find((c) => c.id === 'first-claim')!.cell;

  beforeAll(async () => {
    h = await createIntegrationHarness({ captureLogs: true });
    await seedFixtureWeeks(h.tdb, fixture);
    const deps = reckoningDeps(h.tdb, h.clock);
    for (const weekId of fixture.weeks) await runFixtureWeek(deps, weekId, h.clock);
  });
  afterAll(async () => {
    await h?.close();
  });

  const deps = () => ({ db: h.tdb.db, pool: h.tdb.pool, clock: h.clock, log: h.app.log });

  it('reports no drift right after a reckoning', async () => {
    const report = await runConsistency(deps(), {});
    expect(report.drifted).toBe(0);
    expect(report.repaired).toBe(0);
    expect(report.repair).toBe(false);
    expect(report.parentsChecked).toBeGreaterThan(0);
    expect(Object.keys(report.byRes).sort()).toEqual(['5', '6', '7', '8']);
    const { rows } = await h.tdb.pool.query<{
      parents_checked: number;
      drifted: number;
      repaired: number;
      sample: unknown[];
    }>(
      'select parents_checked, drifted, repaired, sample from reckoning_consistency where id = $1',
      [report.id],
    );
    expect(rows[0]).toEqual({
      parents_checked: report.parentsChecked,
      drifted: 0,
      repaired: 0,
      sample: [],
    });
  });

  it('records three injected drifts (owner, counts, missing) without touching the rows, then repairs on request', async () => {
    const r8 = cellToBigInt(cellToParent(firstClaim, 8)).toString();
    const r7 = cellToBigInt(cellToParent(firstClaim, 7)).toString();
    const r6 = cellToBigInt(cellToParent(firstClaim, 6)).toString();
    const original = await h.tdb.pool.query<{
      h3: string;
      owner_faction_id: number | null;
      child_owner_counts: Record<string, number>;
      claimed_children: number;
    }>(
      'select h3, owner_faction_id, child_owner_counts, claimed_children from hex_parent_state where h3 in ($1, $2, $3) order by h3',
      [r8, r7, r6],
    );
    expect(original.rows).toHaveLength(3);
    await h.tdb.pool.query('update hex_parent_state set owner_faction_id = 3 where h3 = $1', [r8]);
    await h.tdb.pool.query(
      `update hex_parent_state set child_owner_counts = '{"3": 9}'::jsonb, claimed_children = 9 where h3 = $1`,
      [r7],
    );
    await h.tdb.pool.query('delete from hex_parent_state where h3 = $1', [r6]);

    const before = h.logLines.length;
    const report = await runConsistency(deps(), { repair: false });
    expect(report.drifted).toBe(3);
    expect(report.repaired).toBe(0);
    expect(report.sample.map((d) => d.kind).sort()).toEqual(['counts', 'missing', 'owner']);
    const ownerDrift = report.sample.find((d) => d.kind === 'owner')!;
    expect(ownerDrift).toMatchObject({ h3: cellToParent(firstClaim, 8), res: 8, actualOwner: 3 });
    expect(ownerDrift.expectedOwner).toBe(original.rows.find((r) => r.h3 === r8)!.owner_faction_id);
    const countsDrift = report.sample.find((d) => d.kind === 'counts')!;
    expect(countsDrift).toMatchObject({
      h3: cellToParent(firstClaim, 7),
      res: 7,
      actualCounts: { '3': 9 },
    });
    expect(countsDrift.expectedCounts).toEqual(
      original.rows.find((r) => r.h3 === r7)!.child_owner_counts,
    );
    expect(report.sample.find((d) => d.kind === 'missing')).toMatchObject({
      h3: cellToParent(firstClaim, 6),
      res: 6,
      actualOwner: null,
      actualCounts: {},
    });
    const errorLine = h.logLines.slice(before).find((line) => line.includes('parent drift'));
    expect(errorLine).toBeDefined();
    expect(JSON.parse(errorLine!)).toMatchObject({ level: 50, drifted: 3, repaired: 0 });

    // rows unchanged by the report
    const still = await h.tdb.pool.query<{ h3: string }>(
      'select h3 from hex_parent_state where h3 in ($1, $2, $3)',
      [r8, r7, r6],
    );
    expect(still.rows.map((r) => r.h3).sort()).toEqual([r8, r7].sort());
    const { rows: stored } = await h.tdb.pool.query<{
      drifted: number;
      repaired: number;
      sample: unknown[];
    }>('select drifted, repaired, sample from reckoning_consistency where id = $1', [report.id]);
    expect(stored[0]).toMatchObject({ drifted: 3, repaired: 0 });
    expect(stored[0]!.sample).toHaveLength(3);

    // repair: rows corrected, next run clean; a repair waits for nobody else's lock
    const repaired = await runConsistency(deps(), { repair: true });
    expect(repaired.drifted).toBe(3);
    expect(repaired.repaired).toBe(3);
    expect(repaired.repair).toBe(true);
    const after = await h.tdb.pool.query<{
      h3: string;
      owner_faction_id: number | null;
      child_owner_counts: Record<string, number>;
      claimed_children: number;
    }>(
      'select h3, owner_faction_id, child_owner_counts, claimed_children from hex_parent_state where h3 in ($1, $2, $3) order by h3',
      [r8, r7, r6],
    );
    expect(after.rows).toEqual(original.rows);
    const clean = await runConsistency(deps(), { repair: true });
    expect(clean.drifted).toBe(0);
    expect(clean.repaired).toBe(0);
  });

  it('refuses to repair while a reckoning holds the lock, but still reports', async () => {
    const lock = await holdAdvisoryLock(h.tdb.pool);
    try {
      await expect(runConsistency(deps(), { repair: true })).rejects.toMatchObject({
        name: 'ReckoningRunningError',
      });
      const report = await runConsistency(deps(), { repair: false });
      expect(report.drifted).toBe(0);
    } finally {
      await lock.release();
    }
  });
});
