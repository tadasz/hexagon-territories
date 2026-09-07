import { sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type PgBoss from 'pg-boss';
import type { Db } from '../db/client.js';
import { MS_PER_DAY, type Clock } from '../lib/time.js';
import { SAMPLE_RETENTION_DAYS } from '../modules/walks/limits.js';

export const SAMPLES_PURGE = 'samples.purge';
/** Daily at 03:30 UTC (plan.md Conventions). */
export const SAMPLES_PURGE_CRON = '30 3 * * *';
export const SAMPLES_PURGE_TZ = 'UTC';

export type JobScheduler = Pick<PgBoss, 'createQueue' | 'schedule' | 'work'>;

export interface SamplesPurgeDeps {
  db: Db;
  clock: Clock;
  log: FastifyBaseLogger;
  /** Partitions whose range ends before `now − retentionDays` are dropped (config; default 30). */
  retentionDays?: number;
}

export interface SamplesPurgeResult {
  dropped: string[];
  ensured: string;
}

const PARTITION = /^location_samples_y(\d{4})m(\d{2})$/;

/** `location_samples_y2026m07` → the first instant after July 2026 (UTC). */
export function partitionRangeEnd(name: string): Date | null {
  const match = PARTITION.exec(name);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]), 1));
}

export function partitionNameFor(month: Date): string {
  const y = String(month.getUTCFullYear());
  const m = String(month.getUTCMonth() + 1).padStart(2, '0');
  return `location_samples_y${y}m${m}`;
}

/**
 * Drops every monthly `location_samples` partition whose range ended more than `retentionDays`
 * ago (DETACH, then DROP — O(1) versus deleting rows; Constitution IV) and makes sure next
 * month's partition exists via `ensure_location_samples_partition` (0001_partitions.sql).
 * The default partition is never touched.
 */
export async function runSamplesPurge(deps: SamplesPurgeDeps): Promise<SamplesPurgeResult> {
  const now = deps.clock.now();
  const cutoff = new Date(
    now.getTime() - (deps.retentionDays ?? SAMPLE_RETENTION_DAYS) * MS_PER_DAY,
  );
  const partitions = await deps.db.execute<{ relname: string }>(sql`
    select c.relname from pg_inherits i
    join pg_class c on c.oid = i.inhrelid
    join pg_class p on p.oid = i.inhparent
    where p.relname = 'location_samples' order by c.relname
  `);

  const dropped: string[] = [];
  for (const row of partitions.rows) {
    const end = partitionRangeEnd(row.relname);
    if (!end || end.getTime() >= cutoff.getTime()) continue;
    await deps.db.execute(
      sql`alter table location_samples detach partition ${sql.identifier(row.relname)}`,
    );
    await deps.db.execute(sql`drop table ${sql.identifier(row.relname)}`);
    dropped.push(row.relname);
    deps.log.info(
      { partition: row.relname, rangeEnd: end.toISOString() },
      'samples.purge: dropped',
    );
  }

  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  await deps.db.execute(
    sql`select ensure_location_samples_partition(${nextMonth.toISOString().slice(0, 10)}::date)`,
  );
  const ensured = partitionNameFor(nextMonth);
  deps.log.info({ dropped, ensured, cutoff: cutoff.toISOString() }, 'samples.purge: done');
  return { dropped, ensured };
}

export async function registerSamplesPurge(
  boss: JobScheduler,
  deps: SamplesPurgeDeps,
): Promise<void> {
  await boss.createQueue(SAMPLES_PURGE);
  await boss.schedule(SAMPLES_PURGE, SAMPLES_PURGE_CRON, {}, { tz: SAMPLES_PURGE_TZ });
  await boss.work(SAMPLES_PURGE, async (jobs) => {
    for (const job of jobs) {
      const result = await runSamplesPurge({ ...deps, log: deps.log.child({ jobId: job.id }) });
      deps.log.info({ jobId: job.id, ...result }, `${SAMPLES_PURGE} finished`);
    }
  });
  deps.log.info(`${SAMPLES_PURGE} scheduled (${SAMPLES_PURGE_CRON} ${SAMPLES_PURGE_TZ})`);
}
