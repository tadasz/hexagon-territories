import { sql } from 'drizzle-orm';
import type { DbLike } from '../../db/client.js';
import { bigIntToCell } from '../../lib/h3.js';
import type { WeekStanding } from './schemas.js';

/** Score of one faction in one cell for the week (research.md R8). */
export interface FactionScore {
  factionId: number;
  score: number;
}

/** Decay applied to last reckoning's strength when ranking factions between reckonings. */
export const STANDING_STRENGTH_WEIGHT = 0.5;

/**
 * Pure half of the read model: `leader` = highest score (ties → lowest faction id; null when
 * every score is 0 or there are none); `myFactionShare` = my score / Σ scores rounded to 3
 * decimals (0 when Σ = 0). Ownership is only ever read.
 */
export function computeStanding(
  scores: readonly FactionScore[],
  myFactionId: number | null,
  owner: number | null,
): WeekStanding {
  let total = 0;
  let mine = 0;
  let leader: FactionScore | undefined;
  for (const entry of scores) {
    const score = Math.max(0, entry.score);
    total += score;
    if (entry.factionId === myFactionId) mine += score;
    if (
      score > 0 &&
      (leader === undefined ||
        score > leader.score ||
        (score === leader.score && entry.factionId < leader.factionId))
    ) {
      leader = { factionId: entry.factionId, score };
    }
  }
  const share = total > 0 ? Math.round((mine / total) * 1000) / 1000 : 0;
  return { leader: leader?.factionId ?? null, myFactionShare: Math.min(1, share), owner };
}

type ScoreRow = {
  h3_r9: string;
  faction_id: number;
  score: string | number;
};

type OwnerRow = {
  h3_r9: string;
  owner_faction_id: number | null;
};

/**
 * Week standing for every cell in one round trip: `strength × 0.5` from `hex_faction_strength`
 * plus `capped_meters + capture_bonus_m` from `hex_week_contribution` for `(cell, weekId)`,
 * grouped by faction; `owner` from `hex_state`. Cells are H3 strings; the map is keyed by them.
 */
export async function weekStanding(
  db: DbLike,
  cells: readonly string[],
  weekId: string,
  myFactionId: number | null,
): Promise<Map<string, WeekStanding>> {
  const result = new Map<string, WeekStanding>();
  if (cells.length === 0) return result;
  // `sql.param` binds the whole list as one `bigint[]` (a bare array would expand to a tuple).
  const ids = sql.param(cells.map((cell) => BigInt(`0x${cell}`).toString()));
  const scores = await db.execute<ScoreRow>(sql`
    with s as (
      select h3_r9, faction_id, strength * ${STANDING_STRENGTH_WEIGHT} as score
      from hex_faction_strength where h3_r9 = any(${ids}::bigint[])
      union all
      select h3_r9, faction_id, capped_meters + capture_bonus_m as score
      from hex_week_contribution where h3_r9 = any(${ids}::bigint[]) and week_id = ${weekId}
    )
    select h3_r9, faction_id, sum(score) as score from s group by h3_r9, faction_id
  `);
  const owners = await db.execute<OwnerRow>(sql`
    select h3_r9, owner_faction_id from hex_state where h3_r9 = any(${ids}::bigint[])
  `);

  const byCell = new Map<string, FactionScore[]>();
  for (const row of scores.rows) {
    const cell = bigIntToCell(row.h3_r9);
    const list = byCell.get(cell) ?? [];
    list.push({ factionId: Number(row.faction_id), score: Number(row.score) });
    byCell.set(cell, list);
  }
  const ownerByCell = new Map<string, number | null>();
  for (const row of owners.rows) {
    ownerByCell.set(bigIntToCell(row.h3_r9), row.owner_faction_id);
  }
  for (const cell of cells) {
    result.set(
      cell,
      computeStanding(byCell.get(cell) ?? [], myFactionId, ownerByCell.get(cell) ?? null),
    );
  }
  return result;
}
