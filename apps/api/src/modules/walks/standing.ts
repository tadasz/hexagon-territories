import { sql } from 'drizzle-orm';
import type { DbLike } from '../../db/client.js';
import { bigIntToCell, cellToBigInt } from '../../lib/h3.js';
import { leaderOf, pressureScores } from '../territory/pressure.js';
import type { WeekStanding } from './schemas.js';

/** Score of one faction in one cell for the week (specs/003 research.md R8 = 004 R8). */
export interface FactionScore {
  factionId: number;
  score: number;
}

/**
 * Pure half of the read model: `leader` = the shared `leaderOf` (highest score, ties → lowest
 * faction id; null when every score is 0 or there are none); `myFactionShare` = my score / Σ
 * scores rounded to 3 decimals (0 when Σ = 0). Ownership is only ever read.
 */
export function computeStanding(
  scores: readonly FactionScore[],
  myFactionId: number | null,
  owner: number | null,
): WeekStanding {
  const byFaction = new Map<number, number>();
  let total = 0;
  let mine = 0;
  for (const entry of scores) {
    const score = Math.max(0, entry.score);
    total += score;
    if (entry.factionId === myFactionId) mine += score;
    byFaction.set(entry.factionId, (byFaction.get(entry.factionId) ?? 0) + score);
  }
  const share = total > 0 ? Math.round((mine / total) * 1000) / 1000 : 0;
  return { leader: leaderOf(byFaction), myFactionShare: Math.min(1, share), owner };
}

type OwnerRow = {
  h3_r9: string;
  owner_faction_id: number | null;
};

/**
 * Week standing for every cell: the scores come from the territory module's `pressureScores`
 * (strength × `RULES.DECAY` + this week's capped metres + bonuses, one grouped query — the same
 * read model as `GET /v1/hexes`, specs/004 research.md R8); `owner` from `hex_state`. Cells are
 * H3 strings; the map is keyed by them.
 */
export async function weekStanding(
  db: DbLike,
  cells: readonly string[],
  weekId: string,
  myFactionId: number | null,
): Promise<Map<string, WeekStanding>> {
  const result = new Map<string, WeekStanding>();
  if (cells.length === 0) return result;
  const pressure = await pressureScores(db, cells, weekId);
  // `sql.param` binds the whole list as one `bigint[]` (a bare array would expand to a tuple).
  const ids = sql.param(cells.map((cell) => cellToBigInt(cell).toString()));
  const owners = await db.execute<OwnerRow>(sql`
    select h3_r9, owner_faction_id from hex_state where h3_r9 = any(${ids}::bigint[])
  `);
  const ownerByCell = new Map<string, number | null>();
  for (const row of owners.rows) {
    ownerByCell.set(bigIntToCell(row.h3_r9), row.owner_faction_id);
  }
  for (const cell of cells) {
    const scores = (pressure.get(cell)?.factions ?? []).map((f) => ({
      factionId: f.factionId,
      score: f.score,
    }));
    result.set(cell, computeStanding(scores, myFactionId, ownerByCell.get(cell) ?? null));
  }
  return result;
}
