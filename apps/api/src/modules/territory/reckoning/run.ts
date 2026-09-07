import { sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db, DbLike, Pool } from '../../../db/client.js';
import type { ReckoningStage } from '../../../db/schema/index.js';
import { bigIntToCell } from '../../../lib/h3.js';
import type { Clock } from '../../../lib/time.js';
import type { JobBoss } from '../../../plugins/jobs.js';
import { FLIPS_PREVIEW_MAX, RECKONING_LOCK_KEY } from '../limits.js';
import {
  compareWeekIds,
  isCompleted,
  isWeekId,
  justEndedWeek,
  nextWeekId,
  weekEndUtc,
} from '../weeks.js';
import { loadBatchInputs, reckonBatch, selectCellBatch } from './cells.js';
import { OutOfOrderError, ReckoningRunningError, WeekNotEndedError } from './errors.js';
import { applyParentDeltas, collectParentDeltas, type ParentRow } from './parents.js';
import { enqueueResultPushes } from './push.js';
import { snapshotFactionStats, snapshotLeaderboards } from './rollup.js';
import { advanceCursor, writeBatch } from './writes.js';

/**
 * The weekly reckoning entry points (specs/004-weekly-reckoning/research.md R1–R3, R13; plan.md
 * Shared Semantics 1–8). `runReckoning` is the only code path that changes ownership
 * (Constitution II): stages `walks` → `cells` → `rollup` → `push` → `done`, each committed
 * separately, cells in transactional batches with a persisted cursor.
 */
export interface ReckoningDeps {
  db: Db;
  /** A dedicated client for the advisory lock is taken from here. */
  pool: Pool;
  boss: Pick<JobBoss, 'send'> | null;
  clock: Clock;
  log: FastifyBaseLogger;
  batchSize: number;
  /** 003's stale-walk sweep (`runWalkAutofinish`); absent in tests that do not need it. */
  autofinish?: () => Promise<{ finished: number }>;
  /** Number of walks the sweep would finish (dry run's `staleWalksSkipped`). */
  countStaleWalks?: () => Promise<number>;
  /** Test-only hooks (crash injection, research.md R19). */
  hooks?: { afterBatch?(batch: number): Promise<void> | void };
}

export interface RunReckoningOptions {
  weekId: string;
  dryRun?: boolean;
}

export interface FlipPreview {
  h3: string;
  from: number | null;
  to: number | null;
}

/** Mirrors `ReckoningRunResult` of data-model.md §2.4. */
export interface ReckoningRunResult {
  weekId: string;
  dryRun: boolean;
  status: 'done';
  resumed: boolean;
  hexesProcessed: number;
  flips: number;
  parentFlips: number;
  walksAutofinished: number;
  staleWalksSkipped: number;
  pushQueued: number;
  leaderboardRows: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  flipsPreview: FlipPreview[];
}

/** `db.execute` hands timestamps back as strings (Drizzle leaves raw rows unparsed). */
type ReckoningRow = {
  week_id: string;
  started_at: Date | string;
  finished_at: Date | string | null;
  hexes_processed: number;
  flips: number;
  status: 'running' | 'done' | 'failed';
  stage: ReckoningStage;
  cursor_h3_r9: string | null;
  batches: number;
  parent_flips: number;
  walks_autofinished: number;
  push_queued: number;
  error: string | null;
  attempt: number;
};

async function loadRow(db: DbLike, weekId: string): Promise<ReckoningRow | null> {
  const rows = await db.execute<ReckoningRow>(sql`
    select week_id, started_at, finished_at, hexes_processed, flips, status, stage, cursor_h3_r9,
           batches, parent_flips, walks_autofinished, push_queued, error, attempt
    from reckonings where week_id = ${weekId}
  `);
  return rows.rows[0] ?? null;
}

/** Week id of the last completed reckoning, or null before the first. */
export async function lastDoneWeek(db: DbLike): Promise<string | null> {
  const rows = await db.execute<{ week_id: string }>(sql`
    select week_id from reckonings where status = 'done' order by week_id desc limit 1
  `);
  return rows.rows[0]?.week_id ?? null;
}

/** Earliest week with any contribution, or null when nothing was ever scored. */
export async function earliestContributionWeek(db: DbLike): Promise<string | null> {
  const rows = await db.execute<{ week_id: string }>(sql`
    select min(week_id) as week_id from hex_week_contribution
  `);
  return rows.rows[0]?.week_id ?? null;
}

/**
 * The only week a reckoning may run for next (R2): the week after the last completed one, or
 * — before any reckoning — the earliest contribution week, but never later than the week that
 * just ended (so an empty first week can still anchor the sequence).
 */
export async function expectedWeekId(db: DbLike, now: Date): Promise<string> {
  const last = await lastDoneWeek(db);
  if (last !== null) return nextWeekId(last);
  const earliest = await earliestContributionWeek(db);
  const justEnded = justEndedWeek(now);
  if (earliest !== null && compareWeekIds(earliest, justEnded) < 0) return earliest;
  return justEnded;
}

const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

function resultFromRow(
  row: ReckoningRow,
  opts: {
    resumed: boolean;
    dryRun: boolean;
    staleWalksSkipped: number;
    leaderboardRows: number;
    flipsPreview: FlipPreview[];
    finishedAt: Date;
  },
): ReckoningRunResult {
  const startedAt = toDate(row.started_at);
  const finishedAt = row.finished_at === null ? opts.finishedAt : toDate(row.finished_at);
  return {
    weekId: row.week_id,
    dryRun: opts.dryRun,
    status: 'done',
    resumed: opts.resumed,
    hexesProcessed: Number(row.hexes_processed),
    flips: Number(row.flips),
    parentFlips: Number(row.parent_flips),
    walksAutofinished: Number(row.walks_autofinished),
    staleWalksSkipped: opts.staleWalksSkipped,
    pushQueued: Number(row.push_queued),
    leaderboardRows: opts.leaderboardRows,
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    flipsPreview: opts.flipsPreview,
  };
}

/** Holds `pg_try_advisory_lock(RECKONING_LOCK_KEY)` on a dedicated client (R3). */
export async function withReckoningLock<T>(
  pool: Pool,
  weekId: string | null,
  fn: () => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let locked = false;
  try {
    const res = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock($1::int) as locked',
      [RECKONING_LOCK_KEY],
    );
    locked = res.rows[0]?.locked === true;
    if (!locked) throw new ReckoningRunningError(weekId);
    return await fn();
  } finally {
    if (locked) await client.query('select pg_advisory_unlock($1::int)', [RECKONING_LOCK_KEY]);
    client.release();
  }
}

async function setStage(
  db: DbLike,
  weekId: string,
  stage: ReckoningStage,
  extra?: { walksAutofinished?: number },
): Promise<void> {
  await db.execute(sql`
    update reckonings set stage = ${stage},
      walks_autofinished = coalesce(${extra?.walksAutofinished ?? null}::integer, walks_autofinished)
    where week_id = ${weekId}
  `);
}

async function dryRun(deps: ReckoningDeps, weekId: string, now: Date): Promise<ReckoningRunResult> {
  const startedAt = deps.clock.now();
  const preview = new Map<string, ParentRow>();
  const flipsPreview: FlipPreview[] = [];
  let hexesProcessed = 0;
  let flips = 0;
  let parentFlips = 0;
  await deps.db.transaction(
    async (tx) => {
      let cursor: bigint | null = null;
      for (;;) {
        const cells = await selectCellBatch(tx, weekId, cursor, deps.batchSize);
        if (cells.length === 0) break;
        const inputs = await loadBatchInputs(tx, cells, weekId);
        const batch = reckonBatch(inputs, weekId, {
          warn: (message, context) => deps.log.warn(context, message),
        });
        hexesProcessed += batch.outcomes.length;
        for (const outcome of batch.outcomes) {
          if (!outcome.result.event) continue;
          flips += 1;
          if (flipsPreview.length < FLIPS_PREVIEW_MAX) {
            flipsPreview.push({
              h3: outcome.cell,
              from: outcome.result.event.from,
              to: outcome.result.event.to,
            });
          }
        }
        const parents = await applyParentDeltas(tx, collectParentDeltas(batch.outcomes), now, {
          preview,
        });
        parentFlips += parents.parentFlips;
        cursor = cells[cells.length - 1]!;
      }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  );
  const staleWalksSkipped = deps.countStaleWalks ? await deps.countStaleWalks() : 0;
  const finishedAt = deps.clock.now();
  deps.log.info(
    { weekId, hexesProcessed, flips, parentFlips, staleWalksSkipped },
    'reckoning: dry run complete (nothing written)',
  );
  return {
    weekId,
    dryRun: true,
    status: 'done',
    resumed: false,
    hexesProcessed,
    flips,
    parentFlips,
    walksAutofinished: 0,
    staleWalksSkipped,
    pushQueued: 0,
    leaderboardRows: 0,
    durationMs: Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    flipsPreview,
  };
}

/**
 * Reckons one week. Refuses a malformed id (`RangeError`), a week that has not ended
 * (`WeekNotEndedError`), a week out of sequence (`OutOfOrderError`) and a concurrent run
 * (`ReckoningRunningError`); a completed week answers its stored result. A `dryRun` reads a
 * snapshot, writes nothing, takes no lock and skips the walks stage (R13).
 */
export async function runReckoning(
  deps: ReckoningDeps,
  opts: RunReckoningOptions,
): Promise<ReckoningRunResult> {
  const { weekId } = opts;
  if (!isWeekId(weekId)) throw new RangeError(`not an ISO week id: ${weekId}`);
  const now = deps.clock.now();
  if (!isCompleted(weekId, now)) throw new WeekNotEndedError(weekId, weekEndUtc(weekId));

  const existing = await loadRow(deps.db, weekId);
  if (existing?.status === 'done') {
    return resultFromRow(existing, {
      resumed: false,
      dryRun: false,
      staleWalksSkipped: 0,
      leaderboardRows: 0,
      flipsPreview: [],
      finishedAt: now,
    });
  }
  const expected = await expectedWeekId(deps.db, now);
  if (weekId !== expected) throw new OutOfOrderError(weekId, expected);
  if (opts.dryRun) return dryRun(deps, weekId, now);

  return withReckoningLock(deps.pool, weekId, async () => {
    const log = deps.log.child({ weekId });
    // Re-read under the lock: another run may have finished the week meanwhile.
    let row = await loadRow(deps.db, weekId);
    if (row?.status === 'done') {
      return resultFromRow(row, {
        resumed: false,
        dryRun: false,
        staleWalksSkipped: 0,
        leaderboardRows: 0,
        flipsPreview: [],
        finishedAt: now,
      });
    }
    const resumed = row !== null;
    if (row === null) {
      await deps.db.execute(sql`
        insert into reckonings (week_id, started_at, status, stage, attempt)
        values (${weekId}, ${now}, 'running', 'walks', 1)
      `);
    } else {
      await deps.db.execute(sql`
        update reckonings set status = 'running', error = null, attempt = attempt + 1
        where week_id = ${weekId}
      `);
    }
    row = (await loadRow(deps.db, weekId))!;
    log.info(
      { resumed, stage: row.stage, attempt: row.attempt, cursor: row.cursor_h3_r9 },
      resumed ? 'reckoning: resuming' : 'reckoning: starting',
    );

    let leaderboardRows = 0;
    try {
      let stage = row.stage;
      if (stage === 'walks') {
        const finished = deps.autofinish ? (await deps.autofinish()).finished : 0;
        await setStage(deps.db, weekId, 'cells', { walksAutofinished: finished });
        log.info({ walksAutofinished: finished }, 'reckoning: stage walks done');
        stage = 'cells';
      }
      if (stage === 'cells') {
        let cursor = row.cursor_h3_r9 === null ? null : BigInt(row.cursor_h3_r9);
        let batchNo = Number(row.batches);
        for (;;) {
          const progressed = await deps.db.transaction(async (tx) => {
            const cells = await selectCellBatch(tx, weekId, cursor, deps.batchSize);
            if (cells.length === 0) return null;
            const inputs = await loadBatchInputs(tx, cells, weekId);
            const batch = reckonBatch(inputs, weekId, {
              warn: (message, context) => log.warn(context, message),
            });
            const written = await writeBatch(tx, weekId, batch.outcomes, batch.beneficiaries, now);
            const parents = await applyParentDeltas(tx, collectParentDeltas(batch.outcomes), now);
            const last = cells[cells.length - 1]!;
            await advanceCursor(tx, weekId, last, {
              cells: written.cells,
              flips: written.flips,
              parentFlips: parents.parentFlips,
            });
            return { last, cells: written.cells, flips: written.flips, skipped: batch.skipped };
          });
          if (progressed === null) break;
          cursor = progressed.last;
          batchNo += 1;
          log.info(
            {
              batch: batchNo,
              cells: progressed.cells,
              flips: progressed.flips,
              skipped: progressed.skipped,
              cursor: bigIntToCell(cursor),
            },
            'reckoning: batch committed',
          );
          await deps.hooks?.afterBatch?.(batchNo);
        }
        await setStage(deps.db, weekId, 'rollup');
        stage = 'rollup';
      }
      if (stage === 'rollup') {
        leaderboardRows = await deps.db.transaction(async (tx) => {
          const rows = await snapshotLeaderboards(tx, weekId, now);
          await snapshotFactionStats(tx, weekId);
          await setStage(tx, weekId, 'push');
          return rows;
        });
        log.info({ leaderboardRows }, 'reckoning: stage rollup done');
        stage = 'push';
      }
      if (stage === 'push') {
        const queued = await enqueueResultPushes(deps.boss, deps.db, weekId, log);
        const finishedAt = deps.clock.now();
        await deps.db.execute(sql`
          update reckonings set stage = 'done', status = 'done', push_queued = ${queued},
            finished_at = ${finishedAt}, error = null
          where week_id = ${weekId}
        `);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await deps.db.execute(sql`
        update reckonings set status = 'failed', error = ${message} where week_id = ${weekId}
      `);
      log.error({ err }, 'reckoning: failed');
      throw err;
    }
    const done = (await loadRow(deps.db, weekId))!;
    const result = resultFromRow(done, {
      resumed,
      dryRun: false,
      staleWalksSkipped: 0,
      leaderboardRows,
      flipsPreview: [],
      finishedAt: deps.clock.now(),
    });
    log.info(
      {
        hexesProcessed: result.hexesProcessed,
        flips: result.flips,
        parentFlips: result.parentFlips,
        durationMs: result.durationMs,
      },
      'reckoning: done',
    );
    return result;
  });
}

/**
 * Runs every due week in order (R2): from `expectedWeekId` up to the week that just ended.
 * Nothing to do (no reckoning yet and no contribution at all) returns `[]` without creating a
 * row. Stops at the first failure (the error propagates).
 */
export async function runDueReckonings(
  deps: ReckoningDeps,
  now: Date,
): Promise<ReckoningRunResult[]> {
  const results: ReckoningRunResult[] = [];
  const last = await lastDoneWeek(deps.db);
  if (last === null && (await earliestContributionWeek(deps.db)) === null) {
    deps.log.info('reckoning: nothing to reckon yet (no contributions, no reckonings)');
    return results;
  }
  const until = justEndedWeek(now);
  let weekId = await expectedWeekId(deps.db, now);
  while (compareWeekIds(weekId, until) <= 0) {
    results.push(await runReckoning(deps, { weekId }));
    weekId = nextWeekId(weekId);
  }
  if (results.length === 0) deps.log.info({ next: weekId }, 'reckoning: no week due');
  return results;
}
