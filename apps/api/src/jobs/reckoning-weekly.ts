import { RULES } from '@nature/territory-rules';
import type PgBoss from 'pg-boss';
import {
  runDueReckonings,
  runReckoning,
  type ReckoningDeps,
  type ReckoningRunResult,
} from '../modules/territory/reckoning/run.js';

export const RECKONING_WEEKLY = 'reckoning.weekly';

// Single source of truth for the cron and zone is `packages/territory-rules/src/config.ts`
// (Constitution II; docs/territory-rules.md "Constants summary": Monday 00:00 UTC, one global cutoff).
export const RECKONING_CRON: string = RULES.RECKONING_CRON;
export const RECKONING_TZ: string = RULES.TZ;
/** pg-boss never queues two weekly reckonings at once (research.md R3). */
export const RECKONING_SINGLETON_KEY = 'reckoning.weekly';

/** Subset of a pg-boss instance the job code needs; lets tests pass a fake. */
export type JobScheduler = Pick<PgBoss, 'createQueue' | 'schedule' | 'work'>;

export interface ReckoningJobData {
  /** Explicit ISO week (`YYYY-Www`, UTC) — the admin endpoint; absent for the cron (every due week). */
  weekId?: string;
}

/**
 * The weekly reckoning handler (specs/004-weekly-reckoning/research.md R16): without a week it
 * runs every due week in order (`runDueReckonings`), with one it runs exactly that week. Both
 * paths are `runReckoning`, the only code that changes ownership (Constitution II).
 */
export async function runReckoningWeekly(
  deps: ReckoningDeps,
  data: ReckoningJobData = {},
): Promise<ReckoningRunResult[]> {
  if (data.weekId !== undefined) return [await runReckoning(deps, { weekId: data.weekId })];
  return runDueReckonings(deps, deps.clock.now());
}

/**
 * Creates the queue, schedules it for Monday 00:00 UTC as a singleton and attaches the worker.
 * Idempotent: pg-boss upserts the schedule, so restarting the API never duplicates it.
 */
export async function registerReckoningWeekly(
  boss: JobScheduler,
  deps: ReckoningDeps,
): Promise<void> {
  // Policy `short`: at most one queued reckoning job at a time (pg-boss 10 dedupes the
  // singleton key in state `created` only under this policy); the advisory lock guards the run.
  await boss.createQueue(RECKONING_WEEKLY, { name: RECKONING_WEEKLY, policy: 'short' });
  await boss.schedule(
    RECKONING_WEEKLY,
    RECKONING_CRON,
    {},
    { tz: RECKONING_TZ, singletonKey: RECKONING_SINGLETON_KEY },
  );
  await boss.work<ReckoningJobData>(RECKONING_WEEKLY, async (jobs) => {
    for (const job of jobs) {
      const log = deps.log.child({ jobId: job.id });
      const results = await runReckoningWeekly({ ...deps, log }, job.data ?? {});
      log.info(
        {
          jobId: job.id,
          weeks: results.map((r) => r.weekId),
          flips: results.reduce((sum, r) => sum + r.flips, 0),
        },
        'reckoning.weekly finished',
      );
    }
  });
  deps.log.info(`${RECKONING_WEEKLY} scheduled (${RECKONING_CRON} ${RECKONING_TZ})`);
}
