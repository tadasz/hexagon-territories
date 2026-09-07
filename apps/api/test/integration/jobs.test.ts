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

  it('starts pg-boss and schedules reckoning.weekly for Monday 00:00 UTC', async () => {
    expect(app.jobsStarted).toBe(true);
    const { rows } = await tdb.pool.query<{ name: string; cron: string; timezone: string }>(
      `select name, cron, timezone from pgboss.schedule where name = 'reckoning.weekly'`,
    );
    expect(rows).toEqual([{ name: 'reckoning.weekly', cron: '0 0 * * 1', timezone: 'UTC' }]);
  });

  it('created the three queues of feature 002', async () => {
    const { rows } = await tdb.pool.query<{ name: string }>(
      `select name from pgboss.queue where name in ('reckoning.weekly', 'account.purge', 'account.export') order by name`,
    );
    expect(rows).toEqual([
      { name: 'account.export' },
      { name: 'account.purge' },
      { name: 'reckoning.weekly' },
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
