import { RULES } from '@nature/territory-rules';
import { sql } from 'drizzle-orm';
import type { DbLike } from '../../db/client.js';
import { bigIntToCell, cellToBigInt } from '../../lib/h3.js';

/**
 * The shared "between reckonings" read model (docs/territory-rules.md "Between reckonings",
 * specs/004-weekly-reckoning/research.md R8, plan.md Shared Semantics 9). Used by
 * `GET /v1/hexes`, `GET /v1/hexes/{h3}` and 003's `weekStanding`; it never changes ownership.
 *
 *   score(f) = Σ strength(f) × RULES.DECAY + Σ capped_meters(f, W) + Σ capture_bonus_m(f, W)
 */
export interface FactionPressure {
  factionId: number;
  /** Current `hex_faction_strength` (before decay). */
  strength: number;
  /** This week's counted walking metres. */
  cappedMeters: number;
  /** This week's capture bonuses. */
  bonusMeters: number;
  score: number;
}

export interface CellPressure {
  /** Sorted by faction id; factions with nothing at all are absent. */
  factions: FactionPressure[];
  /** `factionId → score`, the input of `leaderOf`. */
  scores: Map<number, number>;
  leader: number | null;
}

/** Highest score wins; ties → lowest faction id; null when every score is 0 (or there are none). */
export function leaderOf(scores: ReadonlyMap<number, number>): number | null {
  let leader: number | null = null;
  let best = 0;
  for (const [factionId, score] of scores) {
    if (!(score > 0)) continue;
    if (leader === null || score > best || (score === best && factionId < leader)) {
      leader = factionId;
      best = score;
    }
  }
  return leader;
}

/** A cell is contested when the pressure leader exists and differs from the owner. */
export function contestedFor(owner: number | null, leader: number | null): boolean {
  return leader !== null && leader !== owner;
}

/** The pure combination of the two sums per faction into `CellPressure`. */
export function pressureOf(
  rows: readonly {
    factionId: number;
    strength: number;
    cappedMeters: number;
    bonusMeters: number;
  }[],
): CellPressure {
  const factions = rows
    .map((row) => ({
      factionId: row.factionId,
      strength: row.strength,
      cappedMeters: row.cappedMeters,
      bonusMeters: row.bonusMeters,
      score: row.strength * RULES.DECAY + row.cappedMeters + row.bonusMeters,
    }))
    .sort((a, b) => a.factionId - b.factionId);
  const scores = new Map(factions.map((f) => [f.factionId, f.score]));
  return { factions, scores, leader: leaderOf(scores) };
}

type PressureRow = {
  h3_r9: string;
  faction_id: number;
  strength: string | number;
  capped: string | number;
  bonus: string | number;
};

/**
 * Pressure of every cell in one grouped query (no N+1; fine for the 3 000 cells of a full map
 * box). Cells are H3 strings; every requested cell gets an entry, empty when nothing is known.
 */
export async function pressureScores(
  db: DbLike,
  cells: readonly string[],
  weekId: string,
): Promise<Map<string, CellPressure>> {
  const result = new Map<string, CellPressure>();
  if (cells.length === 0) return result;
  // `sql.param` binds the whole list as one `bigint[]` (a bare array would expand to a tuple).
  const ids = sql.param(cells.map((cell) => cellToBigInt(cell).toString()));
  const rows = await db.execute<PressureRow>(sql`
    with s as (
      select h3_r9, faction_id, strength, 0::real as capped, 0::real as bonus
      from hex_faction_strength where h3_r9 = any(${ids}::bigint[])
      union all
      select h3_r9, faction_id, 0::real, capped_meters, capture_bonus_m
      from hex_week_contribution where h3_r9 = any(${ids}::bigint[]) and week_id = ${weekId}
    )
    select h3_r9, faction_id, sum(strength) as strength, sum(capped) as capped, sum(bonus) as bonus
    from s group by h3_r9, faction_id
  `);
  const byCell = new Map<string, PressureRow[]>();
  for (const row of rows.rows) {
    const cell = bigIntToCell(row.h3_r9);
    const list = byCell.get(cell) ?? [];
    list.push(row);
    byCell.set(cell, list);
  }
  for (const cell of cells) {
    result.set(
      cell,
      pressureOf(
        (byCell.get(cell) ?? []).map((row) => ({
          factionId: Number(row.faction_id),
          strength: Number(row.strength),
          cappedMeters: Number(row.capped),
          bonusMeters: Number(row.bonus),
        })),
      ),
    );
  }
  return result;
}
