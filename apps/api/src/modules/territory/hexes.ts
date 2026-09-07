import { sql } from 'drizzle-orm';
import type { DbLike } from '../../db/client.js';
import type { HistoryStrength } from '../../db/schema/index.js';
import { envelopeSql, type Bbox } from '../../lib/geo.js';
import { bigIntToCell, cellToBigInt } from '../../lib/h3.js';
import { HEX_HISTORY_WEEKS } from './limits.js';
import { contestedFor, pressureScores } from './pressure.js';
import type { HexDetail, HexList, HexListItem, HexReckoningEntry } from './schemas.js';

/**
 * The hex read model (specs/004-weekly-reckoning/research.md R9, R10). Reads only; ownership
 * changes exclusively inside `reckoning.weekly` (Constitution II).
 */
export interface ListHexesInput {
  res: number;
  bbox: Bbox;
  /** The current week (`weekIdFor(now)`) the pressure is computed for. */
  weekId: string;
  /** Hard row cap after the area check (a rounding guard). */
  limit: number;
}

type StateListRow = {
  h3_r9: string;
  owner_faction_id: number | null;
  owner_since_week: string | null;
};
type ParentListRow = { h3: string; owner_faction_id: number | null };

/** Res 9 from `hex_state` + the pressure read model; res 5–8 from the materialised parents. */
export async function listHexes(db: DbLike, input: ListHexesInput): Promise<HexList> {
  const envelope = envelopeSql(input.bbox);
  let items: HexListItem[];
  if (input.res === 9) {
    const rows = await db.execute<StateListRow>(sql`
      select h3_r9, owner_faction_id, owner_since_week from hex_state
      where geom && ${envelope} order by h3_r9 limit ${input.limit}
    `);
    const cells = rows.rows.map((row) => bigIntToCell(row.h3_r9));
    const pressure = await pressureScores(db, cells, input.weekId);
    items = rows.rows.map((row, i) => {
      const cell = cells[i]!;
      const leader = pressure.get(cell)?.leader ?? null;
      return {
        h3: cell,
        res: 9,
        owner: row.owner_faction_id,
        ownerSince: row.owner_since_week,
        pressureLeader: leader,
        contested: contestedFor(row.owner_faction_id, leader),
      };
    });
  } else {
    const rows = await db.execute<ParentListRow>(sql`
      select h3, owner_faction_id from hex_parent_state
      where res = ${input.res} and geom && ${envelope} order by h3 limit ${input.limit}
    `);
    items = rows.rows.map((row) => ({
      h3: bigIntToCell(row.h3),
      res: input.res,
      owner: row.owner_faction_id,
      ownerSince: null,
      pressureLeader: null,
      contested: false,
    }));
  }
  return { weekId: input.weekId, res: input.res, items };
}

type DetailStateRow = {
  owner_faction_id: number | null;
  owner_since_week: string | null;
  captain_user_id: string | null;
  captain_name: string | null;
};
type StrengthRow = { faction_id: number; strength: number };
type MeRow = {
  meters: string | number | null;
  capped: string | number | null;
  explored: boolean;
  flipped: boolean;
};
type HistoryRow = {
  week_id: string;
  owner_faction_id: number | null;
  flipped: boolean;
  from_faction: number | null;
  to_faction: number | null;
  captain_user_id: string | null;
  captain_name: string | null;
  strengths: HistoryStrength[];
};

/**
 * Detail of one res-9 cell for the caller: empty state when the cell was never walked (200,
 * never 404). Five small indexed queries.
 */
export async function getHexDetail(
  db: DbLike,
  cell: string,
  weekId: string,
  me: { id: string },
): Promise<HexDetail> {
  const h3 = cellToBigInt(cell).toString();
  const state = await db.execute<DetailStateRow>(sql`
    select s.owner_faction_id, s.owner_since_week, s.captain_user_id, u.display_name as captain_name
    from hex_state s left join users u on u.id = s.captain_user_id
    where s.h3_r9 = ${h3}::bigint
  `);
  const strengths = await db.execute<StrengthRow>(sql`
    select faction_id, strength from hex_faction_strength
    where h3_r9 = ${h3}::bigint order by faction_id
  `);
  const pressure = (await pressureScores(db, [cell], weekId)).get(cell)!;
  const mine = await db.execute<MeRow>(sql`
    select
      (select sum(meters) from hex_week_contribution
        where h3_r9 = ${h3}::bigint and week_id = ${weekId} and user_id = ${me.id}) as meters,
      (select sum(capped_meters) from hex_week_contribution
        where h3_r9 = ${h3}::bigint and week_id = ${weekId} and user_id = ${me.id}) as capped,
      exists(select 1 from hex_week_contribution
        where h3_r9 = ${h3}::bigint and user_id = ${me.id}) as explored,
      exists(select 1 from points_ledger
        where h3_r9 = ${h3}::bigint and user_id = ${me.id} and kind = 'hex_flip') as flipped
  `);
  const history = await db.execute<HistoryRow>(sql`
    select h.week_id, h.owner_faction_id, h.flipped, h.from_faction, h.to_faction,
           h.captain_user_id, u.display_name as captain_name, h.strengths
    from hex_reckoning_history h left join users u on u.id = h.captain_user_id
    where h.h3_r9 = ${h3}::bigint order by h.week_id desc limit ${HEX_HISTORY_WEEKS}
  `);

  const row = state.rows[0];
  const owner = row?.owner_faction_id ?? null;
  const captain =
    row?.captain_user_id && row.captain_name !== null
      ? { userId: row.captain_user_id, displayName: row.captain_name }
      : null;
  const my = mine.rows[0];
  const reckonings: HexReckoningEntry[] = history.rows.map((entry) => ({
    weekId: entry.week_id,
    owner: entry.owner_faction_id,
    flipped: entry.flipped,
    from: entry.from_faction,
    to: entry.to_faction,
    strengths: entry.strengths.map((s) => ({ factionId: s.factionId, strength: s.strength })),
    captain:
      entry.captain_user_id && entry.captain_name !== null
        ? { userId: entry.captain_user_id, displayName: entry.captain_name }
        : null,
  }));
  return {
    h3: cell,
    owner,
    ownerSince: row?.owner_since_week ?? null,
    captain,
    strengths: strengths.rows.map((s) => ({
      factionId: Number(s.faction_id),
      strength: Number(s.strength),
    })),
    week: {
      weekId,
      factions: pressure.factions.map((f) => ({
        factionId: f.factionId,
        cappedMeters: f.cappedMeters,
        bonusMeters: f.bonusMeters,
        score: f.score,
      })),
      pressureLeader: pressure.leader,
      contested: contestedFor(owner, pressure.leader),
    },
    me: {
      meters: Number(my?.meters ?? 0),
      cappedMeters: Number(my?.capped ?? 0),
      explored: my?.explored === true,
      flipped: my?.flipped === true,
      held: row?.captain_user_id !== null && row?.captain_user_id === me.id,
    },
    reckonings,
    captures: [],
  };
}
