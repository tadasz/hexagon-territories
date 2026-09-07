import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUTOFINISH_AFTER_H,
  BATCHES_PER_WINDOW,
  BATCH_WINDOW,
  SAMPLES_PER_BATCH,
  SAMPLES_PER_DAY,
  SAMPLE_RETENTION_DAYS,
  START_CLAMP_FUTURE_MIN,
  START_CLAMP_PAST_H,
  WALKS_PER_HOUR,
  WALK_LIMITS,
  WALK_XP_DAILY_CAP,
  WALK_XP_PER_100M,
  clampStartedAt,
  secondsToUtcMidnight,
  utcDayStart,
  xpForDistance,
} from '../../src/modules/walks/limits.js';

describe('walk limits (plan.md Conventions)', () => {
  it('uses the constants of research.md R6/R10', () => {
    expect(SAMPLES_PER_BATCH).toBe(200);
    expect(BATCHES_PER_WINDOW).toBe(30);
    expect(BATCH_WINDOW).toBe('15 minutes');
    expect(WALKS_PER_HOUR).toBe(20);
    expect(SAMPLES_PER_DAY).toBe(8640);
    expect(WALK_XP_PER_100M).toBe(1);
    expect(WALK_XP_DAILY_CAP).toBe(300);
    expect(AUTOFINISH_AFTER_H).toBe(12);
    expect(SAMPLE_RETENTION_DAYS).toBe(30);
    expect(START_CLAMP_PAST_H).toBe(12);
    expect(START_CLAMP_FUTURE_MIN).toBe(5);
    expect(Object.keys(WALK_LIMITS)).toHaveLength(11);
  });

  it('awards 1 XP per full 100 m of accepted path', () => {
    expect(xpForDistance(0, 0)).toBe(0);
    expect(xpForDistance(99.9, 0)).toBe(0);
    expect(xpForDistance(100, 0)).toBe(1);
    expect(xpForDistance(2611.4, 0)).toBe(26);
    expect(xpForDistance(Number.NaN, 0)).toBe(0);
    expect(xpForDistance(-5, 0)).toBe(0);
  });

  it('caps the day at 300 XP across walks', () => {
    expect(xpForDistance(30_000, 0)).toBe(300);
    expect(xpForDistance(40_000, 0)).toBe(300);
    expect(xpForDistance(2_600, 290)).toBe(10);
    expect(xpForDistance(2_600, 300)).toBe(0);
    expect(xpForDistance(2_600, 5_000)).toBe(0);
    expect(xpForDistance(2_600, -10)).toBe(26);
    expect(xpForDistance(2_600, 0, 20)).toBe(20);
  });

  it('computes the UTC day start and the seconds to midnight', () => {
    expect(utcDayStart(new Date('2026-09-07T10:00:00.000Z')).toISOString()).toBe(
      '2026-09-07T00:00:00.000Z',
    );
    expect(secondsToUtcMidnight(new Date('2026-09-07T10:00:00.000Z'))).toBe(14 * 3600);
    expect(secondsToUtcMidnight(new Date('2026-09-07T23:59:59.500Z'))).toBe(1);
    expect(secondsToUtcMidnight(new Date('2026-09-07T00:00:00.000Z'))).toBe(86_400);
  });

  it('clamps startedAt to [now - 12 h, now + 5 min]', () => {
    const now = new Date('2026-09-07T10:00:00.000Z');
    expect(clampStartedAt(new Date('2026-09-07T08:00:00.000Z'), now).toISOString()).toBe(
      '2026-09-07T08:00:00.000Z',
    );
    expect(clampStartedAt(new Date('2026-09-06T00:00:00.000Z'), now).toISOString()).toBe(
      '2026-09-06T22:00:00.000Z',
    );
    expect(clampStartedAt(new Date('2026-09-08T00:00:00.000Z'), now).toISOString()).toBe(
      '2026-09-07T10:05:00.000Z',
    );
  });

  it('is named in docs/architecture.md §5 "Protection"', () => {
    const doc = readFileSync(resolve(__dirname, '../../../../docs/architecture.md'), 'utf8');
    const backend = doc.slice(doc.indexOf('## 5. Backend'), doc.indexOf('## 6.'));
    expect(backend).toContain('daily walking-XP cap');
    expect(backend).toContain('8 640 samples per day');
    expect(backend).toContain('overlapping-walk guard');
    // Stream C (tasks.md T028) writes the numbers next to "Protection"; enabled with it:
    // expect(backend).toContain(`${WALK_XP_DAILY_CAP} XP`);
    // expect(backend).toContain(`${BATCHES_PER_WINDOW} batches / 15 min`);
  });
});
