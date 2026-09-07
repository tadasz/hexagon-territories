import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { locationSamples, users, walkSessions } from '../../src/db/schema/index.js';
import {
  partitionNameFor,
  partitionRangeEnd,
  runSamplesPurge,
  type SamplesPurgeDeps,
} from '../../src/jobs/samples-purge.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';

describeWithDb('samples.purge (research.md R9, Constitution IV)', () => {
  let h: IntegrationHarness;

  beforeAll(async () => {
    h = await createIntegrationHarness({ now: '2026-09-07T10:00:00.000Z' });
  });
  afterAll(async () => {
    await h?.close();
  });

  const deps = (): SamplesPurgeDeps => ({ db: h.tdb.db, clock: h.clock, log: h.app.log });

  async function partitions(): Promise<string[]> {
    const { rows } = await h.tdb.pool.query<{ relname: string }>(
      `select c.relname from pg_inherits i join pg_class c on c.oid = i.inhrelid
       join pg_class p on p.oid = i.inhparent where p.relname = 'location_samples' order by 1`,
    );
    return rows.map((r) => r.relname);
  }

  it('parses partition names', () => {
    expect(partitionRangeEnd('location_samples_y2026m07')?.toISOString()).toBe(
      '2026-08-01T00:00:00.000Z',
    );
    expect(partitionRangeEnd('location_samples_y2026m12')?.toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
    expect(partitionRangeEnd('location_samples_default')).toBeNull();
    expect(partitionNameFor(new Date('2026-10-01T00:00:00Z'))).toBe('location_samples_y2026m10');
  });

  it('drops partitions older than 30 days, keeps recent ones and ensures next month', async () => {
    await h.tdb.pool.query(`select ensure_location_samples_partition('2026-07-01'::date)`);
    await h.tdb.pool.query(`select ensure_location_samples_partition('2026-08-01'::date)`);
    expect(await partitions()).toEqual(
      expect.arrayContaining([
        'location_samples_y2026m07',
        'location_samples_y2026m08',
        'location_samples_default',
      ]),
    );

    const [user] = await h.tdb.db
      .insert(users)
      .values({ appleSub: 'purge-samples', displayName: 'P', factionId: 1 })
      .returning({ id: users.id });
    const [walk] = await h.tdb.db
      .insert(walkSessions)
      .values({
        userId: user!.id,
        clientWalkId: randomUUID(),
        factionId: 1,
        startedAt: new Date('2026-07-15T08:00:00Z'),
        status: 'finished',
      })
      .returning({ id: walkSessions.id });
    await h.tdb.db.insert(locationSamples).values([
      {
        walkId: walk!.id,
        seq: 0,
        ts: new Date('2026-07-15T08:00:00Z'),
        lat: 54.9,
        lon: 23.9,
        hAcc: 8,
      },
      {
        walkId: walk!.id,
        seq: 1,
        ts: new Date('2026-08-20T08:00:00Z'),
        lat: 54.9,
        lon: 23.9,
        hAcc: 8,
      },
    ]);

    const result = await runSamplesPurge(deps());
    expect(result).toEqual({
      dropped: ['location_samples_y2026m07'],
      ensured: 'location_samples_y2026m10',
    });
    const after = await partitions();
    expect(after).not.toContain('location_samples_y2026m07');
    expect(after).toEqual(
      expect.arrayContaining([
        'location_samples_y2026m08',
        'location_samples_y2026m09',
        'location_samples_y2026m10',
        'location_samples_default',
      ]),
    );
    const { rows } = await h.tdb.pool.query<{ seq: number }>(
      'select seq from location_samples where walk_id = $1 order by seq',
      [walk!.id],
    );
    expect(rows).toEqual([{ seq: 1 }]);
    // the walk itself, its path and per-hex metres are untouched
    const walks = await h.tdb.db
      .select()
      .from(walkSessions)
      .where(walkSessions.id ? undefined : undefined);
    expect(walks.some((w) => w.id === walk!.id)).toBe(true);

    expect(await runSamplesPurge(deps())).toEqual({
      dropped: [],
      ensured: 'location_samples_y2026m10',
    });

    // the August partition falls out of the window on 1 October
    h.clock.set('2026-10-01T04:00:00.000Z');
    expect(await runSamplesPurge(deps())).toEqual({
      dropped: ['location_samples_y2026m08'],
      ensured: 'location_samples_y2026m11',
    });
  });

  it('runs through the registered pg-boss worker', async () => {
    const handler = h.boss.handlers.get('samples.purge');
    expect(handler).toBeDefined();
    await handler!([{ id: 'job-sp-1', name: 'samples.purge', data: {} }]);
    expect(await partitions()).toContain('location_samples_y2026m11');
  });
});
