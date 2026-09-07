import { and, eq, lt, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../../../config.js';
import type { Db, Pool } from '../../../db/client.js';
import { walkSessions } from '../../../db/schema/index.js';
import { runWalkAutofinish } from '../../../jobs/walk-autofinish.js';
import type { Clock } from '../../../lib/time.js';
import type { JobBoss } from '../../../plugins/jobs.js';
import type { ReckoningDeps } from './run.js';

export interface BuildReckoningDepsOptions {
  db: Db;
  pool: Pool;
  boss: Pick<JobBoss, 'send'> | null;
  clock: Clock;
  log: FastifyBaseLogger;
  config: Pick<AppConfig, 'walks' | 'territory'>;
}

/**
 * Wires the reckoning to the rest of the API: 003's `runWalkAutofinish` as the walks stage
 * (plan.md "Dependencies on 003") and the configured batch size. Shared by the jobs registry,
 * the CLI runner and the admin endpoint so all three run the same code.
 */
export function buildReckoningDeps(opts: BuildReckoningDepsOptions): ReckoningDeps {
  const staleCutoff = () =>
    new Date(opts.clock.now().getTime() - opts.config.walks.autofinishAfterH * 3_600_000);
  return {
    db: opts.db,
    pool: opts.pool,
    boss: opts.boss,
    clock: opts.clock,
    log: opts.log,
    batchSize: opts.config.territory.batchSize,
    autofinish: async () => {
      const result = await runWalkAutofinish({
        db: opts.db,
        clock: opts.clock,
        log: opts.log,
        afterH: opts.config.walks.autofinishAfterH,
        xpDailyCap: opts.config.walks.xpDailyCap,
      });
      return { finished: result.finished };
    },
    countStaleWalks: async () => {
      const [row] = await opts.db
        .select({ n: sql<number>`count(*)::int` })
        .from(walkSessions)
        .where(and(eq(walkSessions.status, 'active'), lt(walkSessions.startedAt, staleCutoff())));
      return Number(row?.n ?? 0);
    },
  };
}
