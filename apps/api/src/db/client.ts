import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Db = NodePgDatabase<typeof schema>;
/** A `Db` or the transaction handle `db.transaction(async (tx) => …)` hands out. */
export type DbLike = PgDatabase<NodePgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
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
