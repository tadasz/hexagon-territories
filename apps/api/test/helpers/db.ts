import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { describe } from 'vitest';
import { createDb, createPool, type Db, type Pool } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { resolveDbTestMode } from './db-mode.js';

export { FALLBACK_IMAGE, NATURE_IMAGE, pickContainerImage, resolveDbTestMode } from './db-mode.js';
export type { DbTestMode } from './db-mode.js';

/** `describe` that becomes `describe.skip` (with a printed reason) under SKIP_DB_TESTS. */
export function describeWithDb(name: string, factory: () => void): void {
  const mode = resolveDbTestMode();
  if (mode.kind === 'skip') {
    console.warn(`skipped: ${name} — ${mode.reason}`);
    describe.skip(name, factory);
    return;
  }
  describe(name, factory);
}

export interface TestDatabase {
  name: string;
  url: string;
  pool: Pool;
  db: Db;
  /** Ends the pool and drops the database. */
  close(): Promise<void>;
}

function withDatabase(adminUrl: string, database: string): string {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * Creates `nature_test_<random>` from the admin connection, runs every migration into it and
 * returns a pool bound to it. The role behind `adminUrl` needs CREATEDB (the compose and CI
 * `nature` user is a superuser).
 */
export async function createTestDatabase(adminUrl: string): Promise<TestDatabase> {
  const name = `nature_test_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  const url = withDatabase(adminUrl, name);
  const pool = createPool(url, { max: 4 });
  try {
    await runMigrations(pool);
  } catch (err) {
    await pool.end();
    await dropDatabase(adminUrl, name);
    throw err;
  }

  return {
    name,
    url,
    pool,
    db: createDb(pool),
    async close() {
      await pool.end();
      await dropDatabase(adminUrl, name);
    },
  };
}

async function dropDatabase(adminUrl: string, name: string): Promise<void> {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
