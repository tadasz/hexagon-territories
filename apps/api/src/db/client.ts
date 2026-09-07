import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Db = NodePgDatabase<typeof schema>;
export type Pool = pg.Pool;

export interface PoolOptions {
  /** Upper bound on open connections; the same pool is shared by Drizzle and pg-boss. */
  max?: number;
  connectionTimeoutMillis?: number;
}

/** One `pg.Pool` per process, shared by Drizzle and pg-boss so there is a single connection budget. */
export function createPool(connectionString: string, options: PoolOptions = {}): Pool {
  return new pg.Pool({
    connectionString,
    max: options.max ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 5_000,
  });
}

export function createDb(pool: Pool): Db {
  return drizzle(pool, { schema });
}

export class DatabasePingTimeout extends Error {
  constructor(timeoutMs: number) {
    super(`database ping timed out after ${timeoutMs} ms`);
    this.name = 'DatabasePingTimeout';
  }
}

/** `SELECT 1` bounded by `timeoutMs`; rejects on connection failure or timeout. */
export async function pingDatabase(pool: Pool, timeoutMs = 2_000): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DatabasePingTimeout(timeoutMs)), timeoutMs);
  });
  try {
    await Promise.race([pool.query('SELECT 1'), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
