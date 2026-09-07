import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pino from 'pino';
import { loadConfig } from '../config.js';
import { createDb, createPool, type Pool } from './client.js';

/** apps/api/drizzle, resolved the same way from src/ (tsx) and dist/ (node). */
export const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

/** Applies every pending migration in apps/api/drizzle (journal in drizzle/meta/_journal.json). */
export async function runMigrations(pool: Pool): Promise<void> {
  await migrate(createDb(pool), { migrationsFolder: MIGRATIONS_FOLDER });
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const config = loadConfig();
  const log = pino({ level: config.logLevel });
  const pool = createPool(config.databaseUrl);
  try {
    await runMigrations(pool);
    log.info({ migrationsFolder: MIGRATIONS_FOLDER }, 'migrations applied');
  } catch (err) {
    log.error({ err }, 'migration failed');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
