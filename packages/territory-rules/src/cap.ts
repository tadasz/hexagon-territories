/** Weekly walking cap (`plan.md` "Shared Rule Semantics" item 8). */
import { RULES } from './config.js';
import type { CappedContribution, Contribution } from './types.js';

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Sum metres per `(cell, factionId, userId)` and cap each sum at
 * `WEEKLY_CAP_M_PER_PLAYER_PER_CELL` (2000 m). One row per group (`meters` is the uncapped
 * sum), sorted by cell, factionId, userId. Capture bonuses never pass through this function.
 */
export function applyWeeklyCap(contributions: readonly Contribution[]): CappedContribution[] {
  const groups = new Map<string, CappedContribution>();
  for (const c of contributions) {
    const key = `${c.cell} ${String(c.factionId)} ${c.userId}`;
    const row = groups.get(key);
    if (row) {
      row.meters += c.meters;
    } else {
      groups.set(key, {
        cell: c.cell,
        factionId: c.factionId,
        userId: c.userId,
        meters: c.meters,
        cappedMeters: 0,
      });
    }
  }
  return [...groups.values()]
    .map((r) => ({
      ...r,
      cappedMeters: Math.min(r.meters, RULES.WEEKLY_CAP_M_PER_PLAYER_PER_CELL),
    }))
    .sort(
      (a, b) =>
        compareStrings(a.cell, b.cell) ||
        a.factionId - b.factionId ||
        compareStrings(a.userId, b.userId),
    );
}
