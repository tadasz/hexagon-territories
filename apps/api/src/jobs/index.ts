import type { FastifyBaseLogger } from 'fastify';
import type PgBoss from 'pg-boss';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/client.js';
import type { ObjectStorage } from '../lib/storage.js';
import type { Clock } from '../lib/time.js';
import { ACCOUNT_EXPORT, runAccountExport, type AccountExportJobData } from './account-export.js';
import { ACCOUNT_PURGE, runAccountPurge, type AccountPurgeJobData } from './account-purge.js';
import { RECKONING_WEEKLY, registerReckoningWeekly } from './reckoning-weekly.js';

export { ACCOUNT_EXPORT, ACCOUNT_PURGE, RECKONING_WEEKLY };

/** Every queue the API owns, in registration order. */
export const JOB_NAMES = [RECKONING_WEEKLY, ACCOUNT_PURGE, ACCOUNT_EXPORT] as const;
export type JobName = (typeof JOB_NAMES)[number];

/** Subset of pg-boss the registry drives; tests pass a fake. */
export type JobRegistrar = Pick<PgBoss, 'createQueue' | 'schedule' | 'work'>;

export interface JobDeps {
  db: Db;
  storage: ObjectStorage;
  clock: Clock;
  log: FastifyBaseLogger;
  config: Pick<AppConfig, 'account' | 'jwt'>;
}

/**
 * Creates the three queues and attaches their workers (data-model.md §5). Only
 * `reckoning.weekly` is scheduled; `account.purge` and `account.export` are sent by the routes.
 */
export async function registerJobs(boss: JobRegistrar, deps: JobDeps): Promise<void> {
  await registerReckoningWeekly(boss, deps.log);

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

  deps.log.info({ queues: JOB_NAMES }, 'jobs registered');
}
