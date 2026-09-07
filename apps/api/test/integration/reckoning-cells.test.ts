import { loadFixture, type ReckoningWeeksFixture } from '@nature/h3-fixtures';
import { MIN_TRACKED_STRENGTH } from '@nature/territory-rules';
import { cellToParent } from 'h3-js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { hexFactionStrength, hexWeekContribution } from '../../src/db/schema/index.js';
import { bigIntToCell, cellCentre, cellToBigInt } from '../../src/lib/h3.js';
import {
  loadBatchInputs,
  reckonBatch,
  selectCellBatch,
} from '../../src/modules/territory/reckoning/cells.js';
import {
  applyParentDeltas,
  collectParentDeltas,
} from '../../src/modules/territory/reckoning/parents.js';
import { writeBatch } from '../../src/modules/territory/reckoning/writes.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';
import { seedFixtureWeeks, seedUser, type SeededFixture } from '../helpers/reckoning.js';

const fixture: ReckoningWeeksFixture = loadFixture('reckoning-weeks');
const W35 = fixture.weeks[0]!;
const NOW = new Date('2026-08-31T00:00:05.000Z');

describeWithDb(
  'writeBatch: first-time cells, dropped strengths, flip XP (research.md R5, FR-004/FR-005)',
  () => {
    let h: IntegrationHarness;
    let seeded: SeededFixture;

    beforeAll(async () => {
      h = await createIntegrationHarness();
      seeded = await seedFixtureWeeks(h.tdb, fixture, { weeks: [W35] });
    });
    afterAll(async () => {
      await h?.close();
    });

    async function reckonAndWrite(weekId: string, batchSize = 100) {
      return h.tdb.db.transaction(async (tx) => {
        const cells = await selectCellBatch(tx, weekId, null, batchSize);
        const inputs = await loadBatchInputs(tx, cells, weekId);
        const batch = reckonBatch(inputs, weekId);
        const written = await writeBatch(tx, weekId, batch.outcomes, batch.beneficiaries, NOW);
        const parents = await applyParentDeltas(tx, collectParentDeltas(batch.outcomes), NOW);
        return { cells, batch, written, parents };
      });
    }

    it('selects the union of strength and contribution cells in h3 order and creates first-time rows with parents and a polygon', async () => {
      const { cells, batch, written, parents } = await reckonAndWrite(W35);
      expect(cells.map(bigIntToCell)).toEqual(fixture.cells.map((c) => c.cell).sort());
      expect(batch.outcomes.every((o) => o.isNew)).toBe(true);
      expect(written.cells).toBe(fixture.cells.length);
      expect(written.flips).toBe(fixture.cells.filter((c) => c.weeks[0]!.expected.flipped).length);
      expect(parents.parentFlips).toBeGreaterThanOrEqual(0);

      for (const cell of fixture.cells) {
        const centre = cellCentre(cell.cell);
        const { rows } = await h.tdb.pool.query<{
          h3_r8: string;
          h3_r7: string;
          h3_r6: string;
          h3_r5: string;
          contains: boolean;
          srid: number;
          version: number;
          last_reckoned_week: string;
          last_activity_week: string | null;
        }>(
          `select h3_r8, h3_r7, h3_r6, h3_r5, ST_Contains(geom, ST_SetSRID(ST_Point($2, $3), 4326)) as contains,
                ST_SRID(geom) as srid, version, last_reckoned_week, last_activity_week
         from hex_state where h3_r9 = $1`,
          [cellToBigInt(cell.cell).toString(), centre.lon, centre.lat],
        );
        expect(rows, cell.id).toHaveLength(1);
        expect(bigIntToCell(rows[0]!.h3_r8)).toBe(cellToParent(cell.cell, 8));
        expect(bigIntToCell(rows[0]!.h3_r7)).toBe(cellToParent(cell.cell, 7));
        expect(bigIntToCell(rows[0]!.h3_r6)).toBe(cellToParent(cell.cell, 6));
        expect(bigIntToCell(rows[0]!.h3_r5)).toBe(cellToParent(cell.cell, 5));
        expect(rows[0]!.contains).toBe(true);
        expect(rows[0]!.srid).toBe(4326);
        expect(rows[0]!.version).toBe(0);
        expect(rows[0]!.last_reckoned_week).toBe(W35);
        expect(rows[0]!.last_activity_week).toBe(W35);
      }
      // parent rows created with res and a polygon containing the child's centre
      const flipped = fixture.cells.find((c) => c.id === 'first-claim')!;
      for (const res of [8, 7, 6, 5]) {
        const parent = cellToParent(flipped.cell, res);
        const centre = cellCentre(flipped.cell);
        const { rows } = await h.tdb.pool.query<{
          res: number;
          contains: boolean;
          claimed_children: number;
        }>(
          'select res, ST_Contains(geom, ST_SetSRID(ST_Point($2, $3), 4326)) as contains, claimed_children from hex_parent_state where h3 = $1',
          [cellToBigInt(parent).toString(), centre.lon, centre.lat],
        );
        expect(rows[0]).toMatchObject({ res, contains: true });
        expect(rows[0]!.claimed_children).toBeGreaterThanOrEqual(1);
      }
    });

    it('claims bonus-only cells with no captain and awards flip XP once per beneficiary', async () => {
      const bonusOnly = fixture.cells.find((c) => c.id === 'bonus-only')!;
      expect(bonusOnly.weeks[0]!.expected.owner).toBe(3);
      const { rows } = await h.tdb.pool.query<{
        owner_faction_id: number;
        captain_user_id: string | null;
      }>('select owner_faction_id, captain_user_id from hex_state where h3_r9 = $1', [
        cellToBigInt(bonusOnly.cell).toString(),
      ]);
      expect(rows[0]).toEqual({ owner_faction_id: 3, captain_user_id: null });

      // cap-and-bonus W35 flips null → 1 with walkers u1 (2600 → 2000) and u2 (300)? check the fixture
      const capAndBonus = fixture.cells.find((c) => c.id === 'cap-and-bonus')!;
      const to = capAndBonus.weeks[0]!.expected.event!.to!;
      const winners = capAndBonus.weeks[0]!.expected.capped.filter(
        (c) => c.factionId === to && c.cappedMeters > 0,
      ).map((c) => seeded.users.get(c.userId)!);
      const losers = capAndBonus.weeks[0]!.expected.capped.filter((c) => c.factionId !== to).map(
        (c) => seeded.users.get(c.userId)!,
      );
      expect(winners.length).toBeGreaterThan(0);
      expect(losers.length).toBeGreaterThan(0);
      const { rows: ledger } = await h.tdb.pool.query<{
        user_id: string;
        points: number;
        faction_id: number;
      }>(
        "select user_id, points, faction_id from points_ledger where kind = 'hex_flip' and h3_r9 = $1 order by user_id",
        [cellToBigInt(capAndBonus.cell).toString()],
      );
      expect(ledger.map((r) => r.user_id)).toEqual([...winners].sort());
      expect(ledger.every((r) => r.points === 15 && r.faction_id === to)).toBe(true);
      for (const loser of losers) {
        const { rows: xp } = await h.tdb.pool.query<{ xp: number }>(
          'select xp from users where id = $1',
          [loser],
        );
        // a loser may still have won elsewhere; but no row for this cell
        expect(ledger.some((r) => r.user_id === loser)).toBe(false);
        expect(xp[0]!.xp).toBeGreaterThanOrEqual(0);
      }
      // users.xp = 15 × flip rows of the user
      const { rows: totals } = await h.tdb.pool.query<{ id: string; xp: number; n: string }>(
        "select u.id, u.xp, count(l.id)::text as n from users u left join points_ledger l on l.user_id = u.id and l.kind = 'hex_flip' group by u.id, u.xp",
      );
      for (const row of totals) expect(row.xp, row.id).toBe(15 * Number(row.n));
    });

    it('rerunning writeBatch with the same outcomes adds no ledger rows and no XP', async () => {
      const { rows: before } = await h.tdb.pool.query<{ n: string; xp: string }>(
        "select (select count(*) from points_ledger where kind = 'hex_flip')::text as n, (select sum(xp) from users)::text as xp",
      );
      await h.tdb.db
        .transaction(async (tx) => {
          const cells = await selectCellBatch(tx, W35, null, 100);
          const inputs = await loadBatchInputs(tx, cells, W35);
          // pretend the batch was not committed: reckon from the pre-run state by forcing the guard off
          const batch = reckonBatch(
            inputs.map((i) => ({
              ...i,
              lastReckonedWeek: null,
              owner: null,
              strengths: [],
              exists: true,
            })),
            W35,
          );
          const written = await writeBatch(tx, W35, batch.outcomes, batch.beneficiaries, NOW);
          expect(written.xpRows).toBe(0);
          throw new Error('rollback');
        })
        .catch((err: unknown) => {
          if (!(err instanceof Error) || err.message !== 'rollback') throw err;
        });
      const { rows: after } = await h.tdb.pool.query<{ n: string; xp: string }>(
        "select (select count(*) from points_ledger where kind = 'hex_flip')::text as n, (select sum(xp) from users)::text as xp",
      );
      expect(after).toEqual(before);
    });

    it('deletes strength rows the rules package dropped and keeps the state row', async () => {
      const walker = await seedUser(h.tdb, 'dropper', 2);
      const cell = '891f40da8d7ffff';
      const h3 = cellToBigInt(cell);
      await h.tdb.db.insert(hexFactionStrength).values([
        {
          h3R9: h3,
          factionId: 1,
          strength: MIN_TRACKED_STRENGTH * 1.5,
          lastReckonedWeek: '2026-W34',
        },
        { h3R9: h3, factionId: 2, strength: 900, lastReckonedWeek: '2026-W34' },
      ]);
      await h.tdb.db.insert(hexWeekContribution).values({
        h3R9: h3,
        weekId: W35,
        factionId: 2,
        userId: walker,
        meters: 100,
        cappedMeters: 100,
        walks: 1,
      });
      await h.tdb.db.transaction(async (tx) => {
        const inputs = await loadBatchInputs(tx, [h3], W35);
        const batch = reckonBatch(inputs, W35);
        expect(batch.outcomes[0]?.result.strengths.map((s) => s.factionId)).toEqual([2]);
        await writeBatch(tx, W35, batch.outcomes, batch.beneficiaries, NOW);
      });
      const { rows } = await h.tdb.pool.query<{ faction_id: number; strength: number }>(
        'select faction_id, strength from hex_faction_strength where h3_r9 = $1',
        [h3.toString()],
      );
      expect(rows).toEqual([{ faction_id: 2, strength: 550 }]);
      const { rows: state } = await h.tdb.pool.query<{
        owner_faction_id: number;
        owner_since_week: string;
        captain_user_id: string;
      }>(
        'select owner_faction_id, owner_since_week, captain_user_id from hex_state where h3_r9 = $1',
        [h3.toString()],
      );
      expect(state[0]).toEqual({
        owner_faction_id: 2,
        owner_since_week: W35,
        captain_user_id: walker,
      });
    });
  },
);
