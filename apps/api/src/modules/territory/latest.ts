import { sql } from 'drizzle-orm';
import type { DbLike } from '../../db/client.js';
import { bigIntToCell } from '../../lib/h3.js';
import { MY_FLIPPED_HEXES_MAX } from './limits.js';
import type { FactionTotal, ReckoningLatest } from './schemas.js';
import { nextReckoningAt } from './weeks.js';

type LatestRow = { week_id: string; finished_at: Date | string };
type TotalRow = {
  faction_id: number;
  hexes_owned_r9: number;
  hexes_owned_r7: number;
  meters: number;
  active_users: number;
  captures: number;
  gained: string | number;
  lost: string | number;
};

/**
 * `GET /v1/reckonings/latest` (specs/004-weekly-reckoning/research.md R11): the last `done`
 * reckoning, the snapshot totals joined with the flips gained/lost of the week, and the caller's
 * own flips. Before the first reckoning the week fields are null and the totals empty.
 */
export async function latestReckoning(
  db: DbLike,
  now: Date,
  me: { id: string },
): Promise<ReckoningLatest> {
  const latest = await db.execute<LatestRow>(sql`
    select week_id, finished_at from reckonings where status = 'done' order by week_id desc limit 1
  `);
  const running = await db.execute<{ week_id: string }>(sql`
    select week_id from reckonings where status = 'running' order by week_id desc limit 1
  `);
  const base = {
    nextAt: nextReckoningAt(now).toISOString(),
    inProgress: running.rows[0]?.week_id ?? null,
  };
  const row = latest.rows[0];
  if (!row) {
    return {
      weekId: null,
      ranAt: null,
      ...base,
      factionTotals: [],
      myFlips: 0,
      myFlippedHexes: [],
    };
  }
  const weekId = row.week_id;
  const totals = await db.execute<TotalRow>(sql`
    select s.faction_id, s.hexes_owned_r9, s.hexes_owned_r7, s.meters, s.active_users, s.captures,
      (select count(*) from hex_ownership_events e where e.week_id = ${weekId} and e.to_faction = s.faction_id) as gained,
      (select count(*) from hex_ownership_events e where e.week_id = ${weekId} and e.from_faction = s.faction_id) as lost
    from faction_stats_weekly s where s.week_id = ${weekId} order by s.faction_id
  `);
  const mine = await db.execute<{ h3_r9: string }>(sql`
    select h3_r9 from points_ledger
    where user_id = ${me.id} and week_id = ${weekId} and kind = 'hex_flip' and h3_r9 is not null
    order by h3_r9
  `);
  const factionTotals: FactionTotal[] = totals.rows.map((t) => ({
    factionId: Number(t.faction_id),
    hexesOwnedR9: Number(t.hexes_owned_r9),
    hexesOwnedR7: Number(t.hexes_owned_r7),
    meters: Number(t.meters),
    activeUsers: Number(t.active_users),
    captures: Number(t.captures),
    flipsGained: Number(t.gained),
    flipsLost: Number(t.lost),
  }));
  const finishedAt = row.finished_at instanceof Date ? row.finished_at : new Date(row.finished_at);
  return {
    weekId,
    ranAt: finishedAt.toISOString(),
    ...base,
    factionTotals,
    myFlips: mine.rows.length,
    myFlippedHexes: mine.rows.slice(0, MY_FLIPPED_HEXES_MAX).map((r) => bigIntToCell(r.h3_r9)),
  };
}
