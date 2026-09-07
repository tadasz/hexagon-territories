import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { buildApp, type App } from '../../src/app.js';
import { createTestDatabase, describeWithDb, type TestDatabase } from '../helpers/db.js';
import { testConfig } from '../helpers/app.js';

describeWithDb('pg-boss on the shared pool', () => {
  const adminUrl = inject('adminDatabaseUrl');
  let tdb: TestDatabase;
  let app: App;

  beforeAll(async () => {
    if (!adminUrl) throw new Error('adminDatabaseUrl was not provided by global setup');
    tdb = await createTestDatabase(adminUrl);
    app = await buildApp({
      config: testConfig({ databaseUrl: tdb.url, jobsEnabled: true }),
      logger: false,
      pool: tdb.pool,
      jobs: { retryMs: 1_000 },
    });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await tdb?.close();
  });

  it('starts pg-boss and schedules reckoning.weekly for Monday 00:00 UTC as a singleton', async () => {
    expect(app.jobsStarted).toBe(true);
    const { rows } = await tdb.pool.query<{
      name: string;
      cron: string;
      timezone: string;
      options: { singletonKey?: string };
    }>(`select name, cron, timezone, options from pgboss.schedule where name = 'reckoning.weekly'`);
    expect(
      rows.map(({ options, ...row }) => ({ ...row, singletonKey: options.singletonKey })),
    ).toEqual([
      {
        name: 'reckoning.weekly',
        cron: '0 0 * * 1',
        timezone: 'UTC',
        singletonKey: 'reckoning.weekly',
      },
    ]);
  });

  it('created the queues of features 002, 003 and 004 (push.send with rows only)', async () => {
    const { rows } = await tdb.pool.query<{ name: string }>(
      `select name from pgboss.queue where name in ('reckoning.weekly', 'reckoning.consistency', 'account.purge', 'account.export', 'walk.autofinish', 'samples.purge', 'push.send') order by name`,
    );
    expect(rows).toEqual([
      { name: 'account.export' },
      { name: 'account.purge' },
      { name: 'push.send' },
      { name: 'reckoning.consistency' },
      { name: 'reckoning.weekly' },
      { name: 'samples.purge' },
      { name: 'walk.autofinish' },
    ]);
    // the start-up catch-up found nothing to reckon (no contribution ever) and created no row
    const reckonings = await tdb.pool.query('select 1 from reckonings');
    expect(reckonings.rows).toEqual([]);
  });

  it('schedules reckoning.consistency nightly at 03:15 UTC', async () => {
    const { rows } = await tdb.pool.query<{ cron: string; timezone: string }>(
      `select cron, timezone from pgboss.schedule where name = 'reckoning.consistency'`,
    );
    expect(rows).toEqual([{ cron: '15 3 * * *', timezone: 'UTC' }]);
  });

  it('creates reckoning.weekly and push.send with the short policy (singleton keys dedupe)', async () => {
    const { rows } = await tdb.pool.query<{ name: string; policy: string }>(
      `select name, policy from pgboss.queue where name in ('reckoning.weekly', 'push.send') order by name`,
    );
    expect(rows).toEqual([
      { name: 'push.send', policy: 'short' },
      { name: 'reckoning.weekly', policy: 'short' },
    ]);
  });

  it('accepts a push.send row with the reckoning singleton key and a start time', async () => {
    const startAfter = new Date('2026-09-14T08:00:00.000Z');
    const jobId = await app.boss!.send(
      'push.send',
      { kind: 'reckoning_result', userId: 'u', weekId: '2026-W37', flips: 1, lost: 0 },
      { singletonKey: 'reckoning:2026-W37:u', startAfter, expireInHours: 23, retentionDays: 14 },
    );
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
    const again = await app.boss!.send(
      'push.send',
      { kind: 'reckoning_result', userId: 'u', weekId: '2026-W37', flips: 1, lost: 0 },
      { singletonKey: 'reckoning:2026-W37:u', startAfter },
    );
    expect(again).toBeNull();
    const { rows } = await tdb.pool.query<{
      state: string;
      singleton_key: string;
      start_after: Date;
    }>(`select state, singleton_key, start_after from pgboss.job where id = $1`, [jobId]);
    expect(rows).toEqual([
      { state: 'created', singleton_key: 'reckoning:2026-W37:u', start_after: startAfter },
    ]);
  });

  it('schedules walk.autofinish hourly and samples.purge daily at 03:30 UTC', async () => {
    const { rows } = await tdb.pool.query<{ name: string; cron: string; timezone: string }>(
      `select name, cron, timezone from pgboss.schedule where name in ('walk.autofinish', 'samples.purge') order by name`,
    );
    expect(rows).toEqual([
      { name: 'samples.purge', cron: '30 3 * * *', timezone: 'UTC' },
      { name: 'walk.autofinish', cron: '0 * * * *', timezone: 'UTC' },
    ]);
  });

  it('accepts a delayed singleton account.purge job', async () => {
    const startAfter = new Date(Date.now() + 30 * 86_400_000);
    const jobId = await app.boss!.send(
      'account.purge',
      { userId: 'test', deletedAt: new Date().toISOString() },
      { startAfter, singletonKey: 'test', retryLimit: 5, retryBackoff: true },
    );
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/);
    const { rows } = await tdb.pool.query<{ state: string; singleton_key: string }>(
      `select state, singleton_key from pgboss.job where id = $1`,
      [jobId],
    );
    expect(rows).toEqual([{ state: 'created', singleton_key: 'test' }]);
  });
});
