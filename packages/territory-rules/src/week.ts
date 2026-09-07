/** ISO week id (`YYYY-Www`) computed in UTC - one global cutoff at Monday 00:00 UTC. */

const DAY_MS = 86_400_000;

/**
 * ISO 8601 week of `date` evaluated in UTC (`RULES.TZ`). A walk finishing at or after
 * Monday 00:00:00 UTC counts for the new week.
 * @throws RangeError for an invalid date
 */
export function weekIdFor(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new RangeError('invalid date');
  // The Thursday of the same ISO week decides the ISO year.
  const day = date.getUTCDay() || 7; // Mon = 1 ... Sun = 7
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const thursday = new Date(midnight + (4 - day) * DAY_MS);
  const isoYear = thursday.getUTCFullYear();
  const yearStart = Date.UTC(isoYear, 0, 1);
  const week = Math.floor((thursday.getTime() - yearStart) / DAY_MS / 7) + 1;
  return `${String(isoYear).padStart(4, '0')}-W${String(week).padStart(2, '0')}`;
}
