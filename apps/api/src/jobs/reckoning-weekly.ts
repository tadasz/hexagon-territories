import type { FastifyBaseLogger } from 'fastify';
import type PgBoss from 'pg-boss';

export const RECKONING_WEEKLY = 'reckoning.weekly';

// TODO(T044): replace with `import { RULES } from '@nature/territory-rules'` and use
// `RULES.RECKONING_CRON` once Stream E wires the workspace dependency. Value mirrors
// docs/territory-rules.md "Constants summary": Monday 00:00 UTC, one global cutoff for all players.
export const RECKONING_CRON = '0 0 * * 1';
export const RECKONING_TZ = 'UTC';

/** Subset of a pg-boss instance the job code needs; lets tests pass a fake. */
export type JobScheduler = Pick<PgBoss, 'createQueue' | 'schedule' | 'work'>;

export interface ReckoningJobData {
  /** Optional explicit ISO week (`YYYY-Www`, UTC); the job derives the just-ended week otherwise. */
  weekId?: string;
}

export interface ReckoningResult {
  weekId: string | null;
  hexesProcessed: number;
  flips: number;
}

/**
 * The weekly reckoning handler. Feature 004 implements decay, ownership and parent updates here;
 * in 001 it only logs that there is no work (Constitution I/II: nothing writes
 * `hex_state.owner_faction_id` yet).
 */
export function runReckoningWeekly(
  log: FastifyBaseLogger,
  data: ReckoningJobData = {},
): Promise<ReckoningResult> {
  log.info({ weekId: data.weekId ?? null }, 'reckoning.weekly: no work');
  return Promise.resolve({ weekId: data.weekId ?? null, hexesProcessed: 0, flips: 0 });
}

/**
 * Creates the queue, schedules it for Monday 00:00 UTC and attaches the worker. Idempotent:
 * pg-boss upserts the schedule, so restarting the API never duplicates it.
 */
export async function registerReckoningWeekly(
  boss: JobScheduler,
  log: FastifyBaseLogger,
): Promise<void> {
  await boss.createQueue(RECKONING_WEEKLY);
  await boss.schedule(RECKONING_WEEKLY, RECKONING_CRON, {}, { tz: RECKONING_TZ });
  await boss.work<ReckoningJobData>(RECKONING_WEEKLY, async (jobs) => {
    for (const job of jobs) {
      const result = await runReckoningWeekly(log.child({ jobId: job.id }), job.data ?? {});
      log.info({ jobId: job.id, ...result }, 'reckoning.weekly finished');
    }
  });
  log.info(`${RECKONING_WEEKLY} scheduled (${RECKONING_CRON} ${RECKONING_TZ})`);
}
