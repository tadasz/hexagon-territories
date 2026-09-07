import { addDays, type Clock } from '../../lib/time.js';

/**
 * Account rules of feature 002 (research.md R6). These are not territory scoring constants, so
 * they live here rather than in `packages/territory-rules`; `test/unit/factions-rules.test.ts`
 * asserts that docs/territory-rules.md "Other rules" states the same numbers.
 */

/** A player may change faction once every 30 days; the first pick and the first change are free. */
export const FACTION_CHANGE_COOLDOWN_DAYS = 30;

/** "Active players" used the app within this window (`users.last_seen_at`). */
export const ACTIVE_PLAYER_WINDOW_DAYS = 14;

/**
 * When the next faction change is allowed: `factionChangedAt + 30 days`, or null when a change
 * is allowed now (never changed, or the cooldown has passed).
 */
export function factionChangeAvailableAt(
  factionChangedAt: Date | null,
  now: Date,
  cooldownDays = FACTION_CHANGE_COOLDOWN_DAYS,
): Date | null {
  if (factionChangedAt === null) return null;
  const next = addDays(factionChangedAt, cooldownDays);
  return next.getTime() > now.getTime() ? next : null;
}

export function canChangeFaction(
  factionChangedAt: Date | null,
  now: Date,
  cooldownDays = FACTION_CHANGE_COOLDOWN_DAYS,
): boolean {
  return factionChangeAvailableAt(factionChangedAt, now, cooldownDays) === null;
}

/** Start of the active-player window relative to the clock. */
export function activeSince(clock: Clock, windowDays = ACTIVE_PLAYER_WINDOW_DAYS): Date {
  return addDays(clock.now(), -windowDays);
}
