import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import { buildApp, type App } from '../../src/app.js';
import { API_VERSION } from '../../src/version.js';
import { createTestDatabase, describeWithDb, type TestDatabase } from '../helpers/db.js';
import { testConfig } from '../helpers/app.js';

describeWithDb('GET /health against a real database', () => {
  const adminUrl = inject('adminDatabaseUrl');
  let tdb: TestDatabase;
  let app: App;

  beforeAll(async () => {
    if (!adminUrl) throw new Error('adminDatabaseUrl was not provided by global setup');
    tdb = await createTestDatabase(adminUrl);
    app = await buildApp({
      config: testConfig({ databaseUrl: tdb.url }),
      logger: false,
      pool: tdb.pool,
      jobs: false,
    });
  });
  afterAll(async () => {
    await app?.close();
    await tdb?.close();
  });

  it('returns 200 with db: ok', async () => {
    const res = await app.inject({ url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok', version: API_VERSION });
  });

  it('returns 503 with db: error for an unreachable database', async () => {
    const broken = await buildApp({
      config: testConfig({ databaseUrl: 'postgres://nature:nature@127.0.0.1:1/nature' }),
      logger: false,
      jobs: false,
    });
    try {
      const res = await broken.inject({ url: '/health' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ status: 'degraded', db: 'error', version: API_VERSION });
    } finally {
      await broken.close();
    }
  });
});
