import { sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { DbLike } from '../../../db/client.js';
import type { JobBoss } from '../../../plugins/jobs.js';
import { PUSH_EXPIRE_IN_HOURS, PUSH_RETENTION_DAYS, PUSH_START_AFTER_H } from '../limits.js';
import { weekEndUtc } from '../weeks.js';

/** Queue feature 008's push worker will consume; created by `registerJobs`, rows only in 004. */
export const PUSH_SEND = 'push.send';

/** Payload of one queued result push (specs/004-weekly-reckoning/data-model.md §3). */
export interface ReckoningResultPush {
  kind: 'reckoning_result';
  userId: string;
  weekId: string;
  /** Cells the player helped flip to their faction. */
  flips: number;
  /** Cells the player captained before the reckoning whose owner flipped away. */
  lost: number;
}

export function pushSingletonKey(weekId: string, userId: string): string {
  return `reckoning:${weekId}:${userId}`;
}

/** Monday 08:00 UTC after the week (008 replaces this with the player's local morning). */
export function pushStartAfter(weekId: string): Date {
  return new Date(weekEndUtc(weekId).getTime() + PUSH_START_AFTER_H * 3_600_000);
}

type TallyRow = { user_id: string; flips: string | number; lost: string | number };

/** Per contributing player of the week: flips (ledger) and lost captaincies (history). */
export async function pushTallies(db: DbLike, weekId: string): Promise<ReckoningResultPush[]> {
  const rows = await db.execute<TallyRow>(sql`
    with contributors as (
      select distinct user_id from hex_week_contribution where week_id = ${weekId}
    ),
    flips as (
      select user_id, count(*) as n from points_ledger
      where week_id = ${weekId} and kind = 'hex_flip' group by user_id
    ),
    lost as (
      select captain_before_user_id as user_id, count(*) as n from hex_reckoning_history
      where week_id = ${weekId} and flipped and captain_before_user_id is not null
      group by captain_before_user_id
    )
    select c.user_id, coalesce(f.n, 0) as flips, coalesce(l.n, 0) as lost
    from contributors c
    left join flips f on f.user_id = c.user_id
    left join lost l on l.user_id = c.user_id
    order by c.user_id
  `);
  return rows.rows.map((row) => ({
    kind: 'reckoning_result',
    userId: row.user_id,
    weekId,
    flips: Number(row.flips),
    lost: Number(row.lost),
  }));
}

/**
 * Stage `push` (research.md R15, plan.md Shared Semantics 8): one `push.send` row per
 * contributing player with an idempotency key per (week, player). No worker consumes them in
 * feature 004; unconsumed rows expire. With `boss` null (jobs disabled, CLI) the stage logs and
 * skips. Returns the number of rows sent.
 */
export async function enqueueResultPushes(
  boss: Pick<JobBoss, 'send'> | null,
  db: DbLike,
  weekId: string,
  log: FastifyBaseLogger,
): Promise<number> {
  const tallies = await pushTallies(db, weekId);
  if (boss === null) {
    log.warn(
      { weekId, players: tallies.length },
      'reckoning: jobs disabled, result pushes skipped',
    );
    return 0;
  }
  const startAfter = pushStartAfter(weekId);
  let queued = 0;
  for (const payload of tallies) {
    const id = await boss.send(PUSH_SEND, payload, {
      singletonKey: pushSingletonKey(weekId, payload.userId),
      startAfter,
      expireInHours: PUSH_EXPIRE_IN_HOURS,
      retentionDays: PUSH_RETENTION_DAYS,
    });
    if (id !== null) queued += 1;
  }
  log.info({ weekId, players: tallies.length, queued }, 'reckoning: result pushes queued');
  return queued;
}
