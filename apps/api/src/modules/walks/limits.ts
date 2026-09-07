import { MS_PER_DAY, MS_PER_SECOND } from '../../lib/time.js';

/**
 * Abuse limits of feature 003 (research.md R6, R10; plan.md "Conventions"). These are not
 * territory rules — the client never evaluates them and no fixture consumes them — so they live
 * here rather than in `packages/territory-rules`, as 002 did for its account rules.
 * `test/unit/walks-limits.test.ts` asserts that docs/architecture.md §5 names the daily
 * walking-XP cap; Stream C writes the numbers next to it.
 */
export const WALK_LIMITS = {
  /** Samples per `POST /v1/walks/{id}/samples` batch. */
  SAMPLES_PER_BATCH: 200,
  /** Batches per player per `BATCH_WINDOW` (2 per minute on average, bursts for outbox drains). */
  BATCHES_PER_WINDOW: 30,
  BATCH_WINDOW: '15 minutes',
  /** `POST /v1/walks` creations per player per hour. */
  WALKS_PER_HOUR: 20,
  /** Stored samples per player per UTC day (one every 10 s for 24 h). */
  SAMPLES_PER_DAY: 8640,
  /** XP per 100 m of accepted (simplified) path. */
  WALK_XP_PER_100M: 1,
  /** Walking XP per player per UTC day at most. */
  WALK_XP_DAILY_CAP: 300,
  /** Active walks older than this are finished by `walk.autofinish`. */
  AUTOFINISH_AFTER_H: 12,
  /** Raw sample partitions older than this are dropped by `samples.purge`. */
  SAMPLE_RETENTION_DAYS: 30,
  /** `startedAt` is clamped to `[now - START_CLAMP_PAST_H, now + START_CLAMP_FUTURE_MIN]`. */
  START_CLAMP_PAST_H: 12,
  START_CLAMP_FUTURE_MIN: 5,
} as const;

export const {
  SAMPLES_PER_BATCH,
  BATCHES_PER_WINDOW,
  BATCH_WINDOW,
  WALKS_PER_HOUR,
  SAMPLES_PER_DAY,
  WALK_XP_PER_100M,
  WALK_XP_DAILY_CAP,
  AUTOFINISH_AFTER_H,
  SAMPLE_RETENTION_DAYS,
  START_CLAMP_PAST_H,
  START_CLAMP_FUTURE_MIN,
} = WALK_LIMITS;

/** Start of the UTC day containing `now`. */
export function utcDayStart(now: Date): Date {
  return new Date(Math.floor(now.getTime() / MS_PER_DAY) * MS_PER_DAY);
}

/** Whole seconds until the next UTC midnight (at least 1). */
export function secondsToUtcMidnight(now: Date): number {
  const next = utcDayStart(now).getTime() + MS_PER_DAY;
  return Math.max(1, Math.ceil((next - now.getTime()) / MS_PER_SECOND));
}

/**
 * Walking XP for a scored walk (research.md R6): `floor(distanceM / 100) × WALK_XP_PER_100M`,
 * reduced so that the player's walking XP for the current UTC day never exceeds `dailyCap`.
 */
export function xpForDistance(
  distanceM: number,
  alreadyToday: number,
  dailyCap: number = WALK_XP_DAILY_CAP,
): number {
  if (!(distanceM > 0)) return 0;
  const earned = Math.floor(distanceM / 100) * WALK_XP_PER_100M;
  const remaining = Math.max(0, dailyCap - Math.max(0, alreadyToday));
  return Math.max(0, Math.min(earned, remaining));
}

/** `startedAt` clamped to the server's window (plan.md Shared Semantics 3, research.md R3). */
export function clampStartedAt(startedAt: Date, now: Date): Date {
  const earliest = now.getTime() - START_CLAMP_PAST_H * 3_600_000;
  const latest = now.getTime() + START_CLAMP_FUTURE_MIN * 60_000;
  return new Date(Math.min(Math.max(startedAt.getTime(), earliest), latest));
}
