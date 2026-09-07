/**
 * Injectable clock so token expiry, faction locks, purge and export windows can be tested with a
 * fake time instead of waiting (specs/002-auth-and-factions/plan.md, `test/helpers/clock.ts`).
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export const MS_PER_SECOND = 1_000;
export const MS_PER_MINUTE = 60 * MS_PER_SECOND;
export const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * MS_PER_SECOND);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}
