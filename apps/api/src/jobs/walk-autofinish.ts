import { and, lt, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type PgBoss from 'pg-boss';
import type { Db } from '../db/client.js';
import { walkSessions } from '../db/schema/index.js';
import type { Clock } from '../lib/time.js';
import { finishWalk, lastAcceptedSampleTs } from '../modules/walks/finish.js';
import { AUTOFINISH_AFTER_H } from '../modules/walks/limits.js';

export const WALK_AUTOFINISH = 'walk.autofinish';
/** Hourly (docs/architecture.md §5); evaluated in UTC like every other schedule. */
export const WALK_AUTOFINISH_CRON = '0 * * * *';
export const WALK_AUTOFINISH_TZ = 'UTC';

export type JobScheduler = Pick<PgBoss, 'createQueue' | 'schedule' | 'work'>;

export interface WalkAutofinishDeps {
  db: Db;
  clock: Clock;
  log: FastifyBaseLogger;
  /** Walks active for longer than this are finished (config; default 12). */
  afterH?: number;
  /** Daily walking-XP cap handed to `finishWalk`. */
  xpDailyCap?: number;
}

export interface WalkAutofinishResult {
  finished: number;
  failed: number;
  walkIds: string[];
}

/**
 * Finishes every walk still `active` more than `afterH` hours after it started (research.md
 * R9, FR-012) with `endedAt = last accepted sample ?? startedAt` and `reason = 'autofinish'`,
 * each in its own transaction. Idempotent and safe next to a client finish: `finishWalk` locks
 * the row and returns the stored summary when another caller got there first.
 */
export async function runWalkAutofinish(deps: WalkAutofinishDeps): Promise<WalkAutofinishResult> {
  const now = deps.clock.now();
  const cutoff = new Date(now.getTime() - (deps.afterH ?? AUTOFINISH_AFTER_H) * 3_600_000);
  const stale = await deps.db
    .select({ id: walkSessions.id, startedAt: walkSessions.startedAt })
    .from(walkSessions)
    .where(and(eq(walkSessions.status, 'active'), lt(walkSessions.startedAt, cutoff)))
    .orderBy(walkSessions.startedAt);

  const result: WalkAutofinishResult = { finished: 0, failed: 0, walkIds: [] };
  for (const walk of stale) {
    try {
      const summary = await deps.db.transaction(async (tx) => {
        const lastAccepted = await lastAcceptedSampleTs(tx, walk.id);
        return finishWalk(tx, {
          walkId: walk.id,
          endedAt: lastAccepted ?? walk.startedAt,
          reason: 'autofinish',
          now,
          ...(deps.xpDailyCap !== undefined ? { xpDailyCap: deps.xpDailyCap } : {}),
        });
      });
      if (summary.finishReason === 'autofinish') {
        result.finished += 1;
        result.walkIds.push(walk.id);
        deps.log.info(
          { walkId: walk.id, status: summary.status, weekId: summary.weekId, xp: summary.xp },
          'walk.autofinish: finished',
        );
      } else {
        deps.log.info(
          { walkId: walk.id, finishReason: summary.finishReason },
          'walk.autofinish: already finished',
        );
      }
    } catch (err) {
      result.failed += 1;
      deps.log.error({ err, walkId: walk.id }, 'walk.autofinish: failed');
    }
  }
  deps.log.info({ ...result, cutoff: cutoff.toISOString() }, 'walk.autofinish: done');
  return result;
}

/** Creates the queue, schedules it hourly and attaches the worker (idempotent, like the reckoning). */
export async function registerWalkAutofinish(
  boss: JobScheduler,
  deps: WalkAutofinishDeps,
): Promise<void> {
  await boss.createQueue(WALK_AUTOFINISH);
  await boss.schedule(WALK_AUTOFINISH, WALK_AUTOFINISH_CRON, {}, { tz: WALK_AUTOFINISH_TZ });
  await boss.work(WALK_AUTOFINISH, async (jobs) => {
    for (const job of jobs) {
      const result = await runWalkAutofinish({ ...deps, log: deps.log.child({ jobId: job.id }) });
      deps.log.info({ jobId: job.id, ...result }, `${WALK_AUTOFINISH} finished`);
    }
  });
  deps.log.info(`${WALK_AUTOFINISH} scheduled (${WALK_AUTOFINISH_CRON} ${WALK_AUTOFINISH_TZ})`);
}
