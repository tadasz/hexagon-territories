import { loadFixture, type ReckoningWeeksFixture } from '@nature/h3-fixtures';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ReckoningRunningError } from '../../src/modules/territory/reckoning/errors.js';
import { runReckoning } from '../../src/modules/territory/reckoning/run.js';
import { asJobBoss, fakeBoss } from '../helpers/auth.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';
import {
  holdAdvisoryLock,
  reckoningDeps,
  runFixtureWeek,
  seedFixtureWeeks,
  tableSnapshot,
} from '../helpers/reckoning.js';

const fixture: ReckoningWeeksFixture = loadFixture('reckoning-weeks');
const [W35, W36] = fixture.weeks as [string, string];

describeWithDb('reckoning dry run and lock (FR-014, research.md R3/R13)', () => {
  let h: IntegrationHarness;

  beforeAll(async () => {
    h = await createIntegrationHarness();
    await seedFixtureWeeks(h.tdb, fixture);
  });
  afterAll(async () => {
    await h?.close();
  });

  it('previews the flips of W35 without writing a row, then the real run makes exactly those flips', async () => {
    const boss = fakeBoss();
    let autofinishCalls = 0;
    const deps = reckoningDeps(h.tdb, h.clock, {
      batchSize: 3,
      boss: asJobBoss(boss),
      autofinish: () => {
        autofinishCalls += 1;
        return Promise.resolve({ finished: 2 });
      },
      countStaleWalks: () => Promise.resolve(2),
    });
    const before = await tableSnapshot(h.tdb);
    const preview = await runFixtureWeek(deps, W35, h.clock, { dryRun: true });
    expect(preview.dryRun).toBe(true);
    expect(preview.status).toBe('done');
    expect(preview.staleWalksSkipped).toBe(2);
    expect(preview.walksAutofinished).toBe(0);
    expect(preview.pushQueued).toBe(0);
    expect(preview.leaderboardRows).toBe(0);
    expect(preview.hexesProcessed).toBe(fixture.cells.length);
    expect(autofinishCalls).toBe(0);
    expect(boss.sent).toEqual([]);
    expect(await tableSnapshot(h.tdb)).toEqual(before);
    const { rows } = await h.tdb.pool.query('select 1 from reckonings');
    expect(rows).toEqual([]);

    const expectedFlips = fixture.cells
      .filter((c) => c.weeks[0]!.expected.flipped)
      .map((c) => ({
        h3: c.cell,
        from: c.weeks[0]!.expected.event!.from,
        to: c.weeks[0]!.expected.event!.to,
      }))
      .sort((a, b) => (a.h3 < b.h3 ? -1 : 1));
    expect(preview.flipsPreview).toEqual(expectedFlips);
    expect(preview.flips).toBe(expectedFlips.length);

    const real = await runFixtureWeek(deps, W35, h.clock);
    expect(real.dryRun).toBe(false);
    expect(real.walksAutofinished).toBe(2);
    expect(autofinishCalls).toBe(1);
    expect(real.flips).toBe(preview.flips);
    expect(real.parentFlips).toBe(preview.parentFlips);
    expect(real.flipsPreview).toEqual([]);
    const { rows: events } = await h.tdb.pool.query<{
      h3_r9: string;
      from_faction: number | null;
      to_faction: number | null;
    }>(
      'select h3_r9, from_faction, to_faction from hex_ownership_events where week_id = $1 order by h3_r9',
      [W35],
    );
    expect(
      events.map((e) => ({
        h3: BigInt(e.h3_r9).toString(16).padStart(15, '0'),
        from: e.from_faction,
        to: e.to_faction,
      })),
    ).toEqual(expectedFlips);
    expect(boss.sent.length).toBe(real.pushQueued);
  });

  it('a dry run of the next week sees the committed state and takes no lock', async () => {
    const lock = await holdAdvisoryLock(h.tdb.pool);
    try {
      const preview = await runFixtureWeek(reckoningDeps(h.tdb, h.clock), W36, h.clock, {
        dryRun: true,
      });
      expect(preview.dryRun).toBe(true);
      const expectedFlips = fixture.cells.filter((c) => c.weeks[1]!.expected.flipped).length;
      expect(preview.flips).toBe(expectedFlips);
      // ... while a real run is refused within 100 ms
      const started = Date.now();
      await expect(runReckoning(reckoningDeps(h.tdb, h.clock), { weekId: W36 })).rejects.toThrow(
        ReckoningRunningError,
      );
      expect(Date.now() - started).toBeLessThan(100);
      const { rows } = await h.tdb.pool.query<{ week_id: string }>(
        'select week_id from reckonings order by week_id',
      );
      expect(rows).toEqual([{ week_id: W35 }]);
    } finally {
      await lock.release();
    }
    // lock released: the real run proceeds
    const real = await runFixtureWeek(reckoningDeps(h.tdb, h.clock), W36, h.clock);
    expect(real.status).toBe('done');
  });
});
