import { loadFixture, type ReckoningWeeksFixture } from '@nature/h3-fixtures';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { cellToBigInt } from '../../src/lib/h3.js';
import { runReckoning } from '../../src/modules/territory/reckoning/run.js';
import { asJobBoss, fakeBoss } from '../helpers/auth.js';
import { FakeClock } from '../helpers/clock.js';
import { createTestDatabase, describeWithDb, type TestDatabase } from '../helpers/db.js';
import {
  reckoningDeps,
  runFixtureWeek,
  seedFixtureWeeks,
  tableSnapshot,
} from '../helpers/reckoning.js';

const fixture: ReckoningWeeksFixture = loadFixture('reckoning-weeks');
const W35 = fixture.weeks[0]!;

describeWithDb(
  'reckoning.weekly resumes after a crash and is idempotent per week (SC-002, FR-009)',
  () => {
    const adminUrl = inject('adminDatabaseUrl');
    let crashed: TestDatabase;
    let clean: TestDatabase;

    beforeAll(async () => {
      if (!adminUrl) throw new Error('adminDatabaseUrl was not provided by global setup');
      crashed = await createTestDatabase(adminUrl);
      clean = await createTestDatabase(adminUrl);
      await seedFixtureWeeks(crashed, fixture);
      await seedFixtureWeeks(clean, fixture);
    });
    afterAll(async () => {
      await crashed?.close();
      await clean?.close();
    });

    it('marks the run failed after the crash, keeps the committed batch and resumes from the cursor', async () => {
      const clock = new FakeClock();
      const crashBoss = fakeBoss();
      let batches = 0;
      const crashing = reckoningDeps(crashed, clock, {
        batchSize: 3,
        boss: asJobBoss(crashBoss),
        hooks: {
          afterBatch: (n) => {
            batches = n;
            if (n === 1) throw new Error('simulated crash after batch 1');
          },
        },
      });
      await expect(runFixtureWeek(crashing, W35, clock)).rejects.toThrow('simulated crash');
      expect(batches).toBe(1);

      const { rows: afterCrash } = await crashed.pool.query<{
        status: string;
        stage: string;
        cursor_h3_r9: string | null;
        batches: number;
        hexes_processed: number;
        error: string | null;
        attempt: number;
      }>(
        'select status, stage, cursor_h3_r9, batches, hexes_processed, error, attempt from reckonings',
      );
      expect(afterCrash).toHaveLength(1);
      expect(afterCrash[0]).toMatchObject({
        status: 'failed',
        stage: 'cells',
        batches: 1,
        hexes_processed: 3,
        attempt: 1,
      });
      expect(afterCrash[0]?.error).toContain('simulated crash');
      const sortedCells = fixture.cells.map((c) => c.cell).sort();
      expect(afterCrash[0]?.cursor_h3_r9).toBe(cellToBigInt(sortedCells[2]!).toString());
      const { rows: reckonedSoFar } = await crashed.pool.query<{ n: string }>(
        'select count(*)::text as n from hex_state where last_reckoned_week = $1',
        [W35],
      );
      expect(reckonedSoFar[0]?.n).toBe('3');
      expect(crashBoss.sent).toEqual([]);

      // the rerun resumes: attempt 2, only the remaining cells, then rollup and push
      const resuming = reckoningDeps(crashed, clock, { batchSize: 3, boss: asJobBoss(crashBoss) });
      const resumed = await runFixtureWeek(resuming, W35, clock);
      expect(resumed.resumed).toBe(true);
      expect(resumed.hexesProcessed).toBe(fixture.cells.length);
      const { rows: afterResume } = await crashed.pool.query<{
        status: string;
        stage: string;
        batches: number;
        attempt: number;
        error: string | null;
      }>('select status, stage, batches, attempt, error from reckonings');
      expect(afterResume[0]).toEqual({
        status: 'done',
        stage: 'done',
        batches: Math.ceil(fixture.cells.length / 3),
        attempt: 2,
        error: null,
      });
      // no cell was reckoned twice: one history row per cell, one event per flipped cell
      const { rows: history } = await crashed.pool.query<{ n: string }>(
        'select count(*)::text as n from hex_reckoning_history where week_id = $1',
        [W35],
      );
      expect(history[0]?.n).toBe(String(fixture.cells.length));
      const { rows: events } = await crashed.pool.query<{ n: string }>(
        'select count(*)::text as n from hex_ownership_events where week_id = $1',
        [W35],
      );
      expect(events[0]?.n).toBe(
        String(fixture.cells.filter((c) => c.weeks[0]!.expected.flipped).length),
      );

      // row for row, the resumed database equals a clean run on a second database
      const cleanBoss = fakeBoss();
      const cleanClock = new FakeClock();
      const cleanResult = await runFixtureWeek(
        reckoningDeps(clean, cleanClock, { batchSize: 3, boss: asJobBoss(cleanBoss) }),
        W35,
        cleanClock,
      );
      expect(cleanResult.resumed).toBe(false);
      expect(cleanResult.hexesProcessed).toBe(resumed.hexesProcessed);
      expect(cleanResult.flips).toBe(resumed.flips);
      expect(cleanResult.parentFlips).toBe(resumed.parentFlips);
      expect(cleanResult.pushQueued).toBe(resumed.pushQueued);
      expect(await tableSnapshot(crashed)).toEqual(await tableSnapshot(clean));
      expect(crashBoss.sent).toEqual(cleanBoss.sent);
      expect(crashBoss.sent.length).toBe(resumed.pushQueued);
    });

    it('answers the stored result for a done week and changes zero rows (idempotent rerun)', async () => {
      const clock = new FakeClock();
      const boss = fakeBoss();
      const before = await tableSnapshot(crashed);
      const again = await runFixtureWeek(
        reckoningDeps(crashed, clock, { boss: asJobBoss(boss) }),
        W35,
        clock,
      );
      expect(again.resumed).toBe(false);
      expect(again.status).toBe('done');
      expect(again.hexesProcessed).toBe(fixture.cells.length);
      expect(await tableSnapshot(crashed)).toEqual(before);
      expect(boss.sent).toEqual([]);
      const { rows } = await crashed.pool.query<{ attempt: number }>(
        'select attempt from reckonings',
      );
      expect(rows[0]?.attempt).toBe(2);
    });

    it('skips a cell whose state already carries the week (second idempotency guard)', async () => {
      // W36 on the clean database: pre-mark one cell as reckoned for W36 with a bogus owner and
      // check the run leaves it alone while the others are reckoned.
      const W36 = fixture.weeks[1]!;
      const marked = fixture.cells[3]!.cell;
      await clean.pool.query(
        'update hex_state set last_reckoned_week = $1, owner_faction_id = 3, version = 99 where h3_r9 = $2',
        [W36, cellToBigInt(marked).toString()],
      );
      const clock = new FakeClock();
      const result = await runFixtureWeek(
        reckoningDeps(clean, clock, { batchSize: 4 }),
        W36,
        clock,
      );
      expect(result.hexesProcessed).toBe(fixture.cells.length - 1);
      const { rows } = await clean.pool.query<{ owner_faction_id: number; version: number }>(
        'select owner_faction_id, version from hex_state where h3_r9 = $1',
        [cellToBigInt(marked).toString()],
      );
      expect(rows[0]).toEqual({ owner_faction_id: 3, version: 99 });
      const { rows: history } = await clean.pool.query<{ n: string }>(
        'select count(*)::text as n from hex_reckoning_history where week_id = $1 and h3_r9 = $2',
        [W36, cellToBigInt(marked).toString()],
      );
      expect(history[0]?.n).toBe('0');
      // a direct call with the same week is the stored result, nothing more
      const repeat = await runReckoning(reckoningDeps(clean, clock), { weekId: W36 });
      expect(repeat.hexesProcessed).toBe(fixture.cells.length - 1);
    });
  },
);
