import type { FastifyBaseLogger } from 'fastify';
import type PgBoss from 'pg-boss';
import type { AppConfig } from '../config.js';
import type { Db, Pool } from '../db/client.js';
import type { ObjectStorage } from '../lib/storage.js';
import type { Clock } from '../lib/time.js';
import { buildReckoningDeps } from '../modules/territory/reckoning/deps.js';
import { PUSH_SEND } from '../modules/territory/reckoning/push.js';
import { runDueReckonings } from '../modules/territory/reckoning/run.js';
import { ACCOUNT_EXPORT, runAccountExport, type AccountExportJobData } from './account-export.js';
import { ACCOUNT_PURGE, runAccountPurge, type AccountPurgeJobData } from './account-purge.js';
import { RECKONING_CONSISTENCY, registerReckoningConsistency } from './reckoning-consistency.js';
import { RECKONING_WEEKLY, registerReckoningWeekly } from './reckoning-weekly.js';
import { SAMPLES_PURGE, registerSamplesPurge } from './samples-purge.js';
import { WALK_AUTOFINISH, registerWalkAutofinish } from './walk-autofinish.js';

export {
  ACCOUNT_EXPORT,
  ACCOUNT_PURGE,
  PUSH_SEND,
  RECKONING_CONSISTENCY,
  RECKONING_WEEKLY,
  SAMPLES_PURGE,
  WALK_AUTOFINISH,
};

/** Every queue the API owns, in registration order (`push.send` has no worker until feature 008). */
export const JOB_NAMES = [
  RECKONING_WEEKLY,
  RECKONING_CONSISTENCY,
  WALK_AUTOFINISH,
  SAMPLES_PURGE,
  ACCOUNT_PURGE,
  ACCOUNT_EXPORT,
  PUSH_SEND,
] as const;
export type JobName = (typeof JOB_NAMES)[number];

/** Subset of pg-boss the registry drives; tests pass a fake. */
export type JobRegistrar = Pick<PgBoss, 'createQueue' | 'schedule' | 'work' | 'send'>;

export interface JobDeps {
  db: Db;
  /** For the reckoning's advisory lock (a dedicated client per run). */
  pool: Pool;
  storage: ObjectStorage;
  clock: Clock;
  log: FastifyBaseLogger;
  config: Pick<AppConfig, 'account' | 'jwt' | 'walks' | 'territory'>;
  /**
   * Run every missed reckoning once after registration (FR-001, research.md R2). Default true;
   * tests that seed their own weeks turn it off.
   */
  catchUp?: boolean;
}

/**
 * Creates the queues and attaches their workers (002 data-model.md §5, 003 data-model.md §3,
 * 004 data-model.md §3). `reckoning.weekly`, `reckoning.consistency`, `walk.autofinish` and
 * `samples.purge` are scheduled; `account.purge` and `account.export` are sent by the routes;
 * `push.send` only receives rows (the worker is feature 008). Finally the missed reckonings are
 * caught up; a failure there is logged, never thrown (the API still boots).
 */
export async function registerJobs(boss: JobRegistrar, deps: JobDeps): Promise<void> {
  const reckoning = buildReckoningDeps({
    db: deps.db,
    pool: deps.pool,
    boss,
    clock: deps.clock,
    log: deps.log,
    config: deps.config,
  });
  await registerReckoningWeekly(boss, reckoning);
  await registerReckoningConsistency(
    boss,
    { db: deps.db, pool: deps.pool, clock: deps.clock, log: deps.log },
    deps.config.territory.consistencyCron,
  );
  await registerWalkAutofinish(boss, {
    db: deps.db,
    clock: deps.clock,
    log: deps.log,
    afterH: deps.config.walks.autofinishAfterH,
    xpDailyCap: deps.config.walks.xpDailyCap,
  });
  await registerSamplesPurge(boss, {
    db: deps.db,
    clock: deps.clock,
    log: deps.log,
    retentionDays: deps.config.walks.sampleRetentionDays,
  });

  await boss.createQueue(ACCOUNT_PURGE);
  await boss.work<AccountPurgeJobData>(ACCOUNT_PURGE, async (jobs) => {
    for (const job of jobs) {
      const result = await runAccountPurge(
        {
          db: deps.db,
          storage: deps.storage,
          clock: deps.clock,
          log: deps.log.child({ jobId: job.id }),
          graceDays: deps.config.account.purgeGraceDays,
        },
        job.data,
      );
      deps.log.info({ jobId: job.id, ...result }, `${ACCOUNT_PURGE} finished`);
    }
  });

  await boss.createQueue(ACCOUNT_EXPORT);
  await boss.work<AccountExportJobData>(ACCOUNT_EXPORT, { includeMetadata: true }, async (jobs) => {
    for (const job of jobs) {
      const result = await runAccountExport(
        {
          db: deps.db,
          storage: deps.storage,
          clock: deps.clock,
          log: deps.log.child({ jobId: job.id }),
          exportTtlDays: deps.config.account.exportTtlDays,
          refreshTtlDays: deps.config.jwt.refreshTtlDays,
        },
        job.data,
        { finalAttempt: job.retryCount >= job.retryLimit },
      );
      deps.log.info({ jobId: job.id, ...result }, `${ACCOUNT_EXPORT} finished`);
    }
  });

  // Feature 004: rows only; feature 008 attaches the worker and the devices. Policy `short`:
  // pg-boss 10 dedupes `singletonKey` in state `created` only under this policy (one queued
  // push per player and week, research.md R15).
  await boss.createQueue(PUSH_SEND, { name: PUSH_SEND, policy: 'short' });

  deps.log.info({ queues: JOB_NAMES }, 'jobs registered');

  if (deps.catchUp !== false) {
    try {
      const results = await runDueReckonings(reckoning, deps.clock.now());
      if (results.length > 0) {
        deps.log.info(
          { weeks: results.map((r) => r.weekId) },
          'reckoning.weekly: caught up missed weeks at start-up',
        );
      }
    } catch (err) {
      deps.log.error({ err }, 'reckoning.weekly: start-up catch-up failed');
    }
  }
}
