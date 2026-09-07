import type { FastifyBaseLogger } from 'fastify';
import type PgBoss from 'pg-boss';
import type { Db, Pool } from '../db/client.js';
import { reckoningConsistency } from '../db/schema/index.js';
import type { Clock } from '../lib/time.js';
import { RECKONING_CONSISTENCY_CRON } from '../modules/territory/limits.js';
import {
  recomputeParents,
  type ConsistencyReport,
} from '../modules/territory/reckoning/parents.js';
import { withReckoningLock } from '../modules/territory/reckoning/run.js';

export const RECKONING_CONSISTENCY = 'reckoning.consistency';
export const RECKONING_CONSISTENCY_TZ = 'UTC';
export const RECKONING_CONSISTENCY_SINGLETON_KEY = 'reckoning.consistency';

export type JobScheduler = Pick<PgBoss, 'createQueue' | 'schedule' | 'work'>;

export interface ConsistencyDeps {
  db: Db;
  pool: Pool;
  clock: Clock;
  log: FastifyBaseLogger;
}

export interface ConsistencyJobData {
  /** Upsert the recomputed parent rows; the cron never sets it (research.md R6). */
  repair?: boolean;
}

export interface ConsistencyResult extends ConsistencyReport {
  id: number;
  ranAt: string;
  repair: boolean;
}

/**
 * Re-derives every res 8–5 parent from `hex_state`, compares with `hex_parent_state`, writes a
 * `reckoning_consistency` row and logs at `error` level when anything drifted (FR-016). Repairs
 * only when asked, and then under the reckoning's advisory lock so a running reckoning and a
 * repair never interleave; the read-only report needs no lock.
 */
export async function runConsistency(
  deps: ConsistencyDeps,
  data: ConsistencyJobData = {},
): Promise<ConsistencyResult> {
  const repair = data.repair === true;
  const now = deps.clock.now();
  const run = () => recomputeParents(deps.db, { repair, now });
  const report = repair ? await withReckoningLock(deps.pool, null, run) : await run();
  const [row] = await deps.db
    .insert(reckoningConsistency)
    .values({
      ranAt: now,
      parentsChecked: report.parentsChecked,
      drifted: report.drifted,
      repaired: report.repaired,
      sample: report.sample,
    })
    .returning({ id: reckoningConsistency.id });
  const summary = {
    parentsChecked: report.parentsChecked,
    drifted: report.drifted,
    repaired: report.repaired,
    byRes: report.byRes,
    repair,
  };
  if (report.drifted > 0) {
    deps.log.error({ ...summary, sample: report.sample }, 'reckoning.consistency: parent drift');
  } else {
    deps.log.info(summary, 'reckoning.consistency: no drift');
  }
  return { ...report, id: row!.id, ranAt: now.toISOString(), repair };
}

/** Creates the queue, schedules the nightly report (UTC, singleton) and attaches the worker. */
export async function registerReckoningConsistency(
  boss: JobScheduler,
  deps: ConsistencyDeps,
  cron: string = RECKONING_CONSISTENCY_CRON,
): Promise<void> {
  await boss.createQueue(RECKONING_CONSISTENCY);
  await boss.schedule(
    RECKONING_CONSISTENCY,
    cron,
    {},
    { tz: RECKONING_CONSISTENCY_TZ, singletonKey: RECKONING_CONSISTENCY_SINGLETON_KEY },
  );
  await boss.work<ConsistencyJobData>(RECKONING_CONSISTENCY, async (jobs) => {
    for (const job of jobs) {
      const result = await runConsistency(
        { ...deps, log: deps.log.child({ jobId: job.id }) },
        { repair: job.data?.repair === true },
      );
      deps.log.info(
        { jobId: job.id, drifted: result.drifted, repaired: result.repaired },
        `${RECKONING_CONSISTENCY} finished`,
      );
    }
  });
  deps.log.info(`${RECKONING_CONSISTENCY} scheduled (${cron} ${RECKONING_CONSISTENCY_TZ})`);
}
