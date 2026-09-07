import { weekIdFor } from '@nature/territory-rules';
import { MS_PER_DAY } from '../../lib/time.js';

/**
 * ISO-week arithmetic on top of the rules package's `weekIdFor` (research.md R2). Every value is
 * UTC: weeks run from Monday 00:00:00.000 UTC (inclusive) to the next Monday 00:00 UTC
 * (exclusive) — one global cutoff, `docs/territory-rules.md` "Vocabulary".
 */
const WEEK_ID = /^(\d{4})-W(\d{2})$/;
const WEEK_MS = 7 * MS_PER_DAY;

/** `YYYY-Www` with a week number that exists in that ISO year. */
export function isWeekId(value: string): boolean {
  const match = WEEK_ID.exec(value);
  if (!match) return false;
  const week = Number(match[2]);
  if (week < 1 || week > 53) return false;
  // Week 53 exists only in years whose December 28 falls in week 53.
  if (week === 53) {
    return weekIdFor(new Date(Date.UTC(Number(match[1]), 11, 28))) === value;
  }
  return true;
}

function parseWeekId(weekId: string): { year: number; week: number } {
  const match = WEEK_ID.exec(weekId);
  if (!match || !isWeekId(weekId)) throw new RangeError(`not an ISO week id: ${weekId}`);
  return { year: Number(match[1]), week: Number(match[2]) };
}

/** Monday 00:00:00.000 UTC that starts the week. */
export function weekStartUtc(weekId: string): Date {
  const { year, week } = parseWeekId(weekId);
  // January 4 is always in ISO week 1; step back to its Monday.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const mondayOfWeek1 = jan4.getTime() - (day - 1) * MS_PER_DAY;
  return new Date(mondayOfWeek1 + (week - 1) * WEEK_MS);
}

/** Monday 00:00 UTC after the week — the instant its reckoning becomes due. */
export function weekEndUtc(weekId: string): Date {
  return new Date(weekStartUtc(weekId).getTime() + WEEK_MS);
}

/** Start of the ISO week containing `now`. */
export function startOfIsoWeekUtc(now: Date): Date {
  return weekStartUtc(weekIdFor(now));
}

/** The week that ended most recently at or before `now` (the one a reckoning at `now` is for). */
export function justEndedWeek(now: Date): string {
  return weekIdFor(new Date(startOfIsoWeekUtc(now).getTime() - 1));
}

export function nextWeekId(weekId: string): string {
  return weekIdFor(weekEndUtc(weekId));
}

export function previousWeekId(weekId: string): string {
  return weekIdFor(new Date(weekStartUtc(weekId).getTime() - 1));
}

/** True once the week's Monday 00:00 UTC end has passed (a reckoning may run). */
export function isCompleted(weekId: string, now: Date): boolean {
  return weekEndUtc(weekId).getTime() <= now.getTime();
}

/** The next Monday 00:00 UTC strictly after `now`. */
export function nextReckoningAt(now: Date): Date {
  return weekEndUtc(weekIdFor(now));
}

/** Text order of week ids equals chronological order (`YYYY-Www`), so plain comparison works. */
export function compareWeekIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
