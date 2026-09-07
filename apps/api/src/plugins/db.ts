import fp from 'fastify-plugin';
import { createDb, createPool, pingDatabase, type Db, type Pool } from '../db/client.js';

export interface DbPluginOptions {
  /** Ignored when `pool` is given. */
  connectionString?: string;
  /** Reuse an existing pool (tests, CLIs). The caller keeps ownership and closes it. */
  pool?: Pool;
  /** Replace the `SELECT 1` readiness probe (unit tests). */
  ping?: () => Promise<void>;
  /** Readiness probe timeout; contracts/openapi.yaml says 2 s. */
  pingTimeoutMs?: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** The single `pg.Pool` shared by Drizzle and pg-boss. */
    pg: Pool;
    /** Drizzle handle bound to the §6 schema. */
    db: Db;
    /** Resolves when Postgres answers `SELECT 1` within the timeout, rejects otherwise. */
    dbPing: () => Promise<void>;
  }
}

/**
 * Creates (or adopts) the process-wide connection pool and exposes it as `fastify.pg`,
 * `fastify.db` and `fastify.dbPing()`. Pool creation is lazy in node-postgres, so an unreachable
 * database does not prevent the API from booting; `/health` reports it instead.
 */
export const dbPlugin = fp<DbPluginOptions>(
  (fastify, opts, done) => {
    const ownsPool = opts.pool === undefined;
    if (!opts.pool && !opts.connectionString) {
      done(new Error('db plugin needs either a pool or a connectionString'));
      return;
    }
    const pool = opts.pool ?? createPool(opts.connectionString as string);
    pool.on('error', (err) => fastify.log.error({ err }, 'postgres pool error'));

    const timeoutMs = opts.pingTimeoutMs ?? 2_000;
    const ping = opts.ping ?? (() => pingDatabase(pool, timeoutMs));

    fastify.decorate('pg', pool);
    fastify.decorate('db', createDb(pool));
    fastify.decorate('dbPing', ping);

    fastify.addHook('onClose', async () => {
      if (ownsPool) await pool.end();
    });
    done();
  },
  { name: 'db', fastify: '5.x' },
);
