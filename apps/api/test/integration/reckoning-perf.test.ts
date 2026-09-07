import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RECKONING_BATCH_SIZE } from '../../src/modules/territory/limits.js';
import { runReckoning } from '../../src/modules/territory/reckoning/run.js';
import { weekEndUtc } from '../../src/modules/territory/weeks.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';
import { gridSeed, reckoningDeps, seedUser } from '../helpers/reckoning.js';

/** roadmap phase-4 exit criterion: 10 000 cells in under 5 minutes (SC-003; design target < 60 s). */
const BUDGET_MS = 300_000;
const WEEK = '2026-W36';
const CENTRE = '891f40da99bffff';
const K = 58; // gridDisk(centre, 58) = 1 + 3·58·59 = 10 267 cells

const skipPerf = process.env.SKIP_PERF === '1';

describeWithDb('reckoning performance (SC-003)', () => {
  describe.skipIf(skipPerf)('10 267 cells with two factions and three walkers', () => {
    let h: IntegrationHarness;
    let cells = 0;

    beforeAll(async () => {
      h = await createIntegrationHarness();
      const users = [];
      for (const name of ['perf-a', 'perf-b', 'perf-c']) users.push(await seedUser(h.tdb, name, 1));
      cells = await gridSeed(h.tdb, CENTRE, K, { factions: [1, 2], users, weekId: WEEK });
    });
    afterAll(async () => {
      await h?.close();
    });

    it(
      `reckons the grid in under ${String(BUDGET_MS / 1000)} s`,
      async () => {
        expect(cells).toBe(10_267);
        h.clock.set(new Date(weekEndUtc(WEEK).getTime() + 1_000));
        const started = performance.now();
        const result = await runReckoning(
          reckoningDeps(h.tdb, h.clock, { batchSize: RECKONING_BATCH_SIZE }),
          {
            weekId: WEEK,
          },
        );
        const durationMs = performance.now() - started;
        const { rows } = await h.tdb.pool.query<{
          batches: number;
          hexes_processed: number;
          parent_flips: number;
        }>('select batches, hexes_processed, parent_flips from reckonings where week_id = $1', [
          WEEK,
        ]);
        console.info(
          `SC-003: reckoned ${String(result.hexesProcessed)} cells in ${(durationMs / 1000).toFixed(1)} s ` +
            `(${String(rows[0]?.batches)} batches of ${String(RECKONING_BATCH_SIZE)}, ${String(result.flips)} flips, ` +
            `${String(result.parentFlips)} parent flips, ${String(result.leaderboardRows)} leaderboard rows)`,
        );
        expect(result.hexesProcessed).toBe(cells);
        expect(rows[0]?.hexes_processed).toBe(cells);
        expect(rows[0]?.batches).toBe(Math.ceil(cells / RECKONING_BATCH_SIZE));
        expect(result.flips).toBeGreaterThan(0);
        expect(durationMs).toBeLessThan(BUDGET_MS);
      },
      BUDGET_MS + 60_000,
    );
  });

  if (skipPerf) {
    it('is skipped with SKIP_PERF=1', () => {
      console.warn('skipped: reckoning-perf — SKIP_PERF=1');
      expect(skipPerf).toBe(true);
    });
  }
});
