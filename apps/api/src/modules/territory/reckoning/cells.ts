import {
  applyWeeklyCap,
  reckonWeek,
  type Contribution,
  type FactionStrength,
  type ReckonBonus,
  type ReckonContribution,
  type ReckonResult,
} from '@nature/territory-rules';
import { sql } from 'drizzle-orm';
import type { DbLike } from '../../../db/client.js';
import { bigIntToCell, cellToBigInt } from '../../../lib/h3.js';

/**
 * Stage `cells` of the reckoning, split into three steps (specs/004-weekly-reckoning/research.md
 * R4, plan.md Shared Semantics 2–3): select the next batch of cells, load their inputs, and
 * reckon them purely with the rules package. Nothing here writes; `writes.ts` does.
 */

/** A raw `hex_week_contribution` row of the reckoned week. */
export interface RawContribution {
  factionId: number;
  userId: string;
  meters: number;
  /** What 003's `finishWalk` stored; cross-checked against `applyWeeklyCap`, never trusted. */
  cappedMeters: number;
  bonusMeters: number;
}

export interface CellInputs {
  cell: string;
  /** A `hex_state` row exists. */
  exists: boolean;
  owner: number | null;
  ownerSinceWeek: string | null;
  captainBefore: string | null;
  lastReckonedWeek: string | null;
  lastActivityWeek: string | null;
  strengths: FactionStrength[];
  rawContributions: RawContribution[];
}

export interface CellOutcome {
  cell: string;
  isNew: boolean;
  owner: number | null;
  captainBefore: string | null;
  result: ReckonResult;
  /** The capped rows handed to `reckonWeek` (with `userId`). */
  contributions: ReckonContribution[];
  hadContributions: boolean;
  /** Final `owner_since_week` (Shared Semantics 4). */
  ownerSinceWeek: string | null;
  /** Final `last_activity_week`. */
  lastActivityWeek: string | null;
}

/** A player whose counted metres were part of a flip to their faction (Shared Semantics 5). */
export interface FlipBeneficiary {
  cell: string;
  userId: string;
  factionId: number;
}

export interface BatchResult {
  outcomes: CellOutcome[];
  beneficiaries: FlipBeneficiary[];
  /** Cells whose `hex_state.last_reckoned_week` already equals the week (second guard). */
  skipped: number;
  /** Capped rows whose stored `capped_meters` disagreed with `applyWeeklyCap` (logged, never fatal). */
  capDrift: number;
}

const CAP_DRIFT_TOLERANCE_M = 0.01;

/**
 * The next `limit` cells after `cursor` (exclusive) that have strength or a contribution in the
 * week, ascending by `h3_r9` (Shared Semantics 2).
 */
export async function selectCellBatch(
  db: DbLike,
  weekId: string,
  cursor: bigint | null,
  limit: number,
): Promise<bigint[]> {
  const after = cursor === null ? sql`true` : sql`h3_r9 > ${cursor.toString()}::bigint`;
  const rows = await db.execute<{ h3_r9: string }>(sql`
    select h3_r9 from (
      select h3_r9 from hex_faction_strength where ${after}
      union
      select h3_r9 from hex_week_contribution where week_id = ${weekId} and ${after}
    ) cells
    order by h3_r9
    limit ${limit}
  `);
  return rows.rows.map((row) => BigInt(row.h3_r9));
}

type StateRow = {
  h3_r9: string;
  owner_faction_id: number | null;
  owner_since_week: string | null;
  captain_user_id: string | null;
  last_reckoned_week: string | null;
  last_activity_week: string | null;
};
type StrengthRow = { h3_r9: string; faction_id: number; strength: number };
type ContributionRow = {
  h3_r9: string;
  faction_id: number;
  user_id: string;
  meters: number;
  capped_meters: number;
  capture_bonus_m: number;
};

/** Three queries per batch: states, strengths and the week's contributions of the cells. */
export async function loadBatchInputs(
  db: DbLike,
  cells: readonly bigint[],
  weekId: string,
): Promise<CellInputs[]> {
  if (cells.length === 0) return [];
  const ids = sql.param(cells.map((cell) => cell.toString()));
  // Sequential on purpose: the three run on one transaction client.
  const states = await db.execute<StateRow>(sql`
    select h3_r9, owner_faction_id, owner_since_week, captain_user_id, last_reckoned_week,
           last_activity_week
    from hex_state where h3_r9 = any(${ids}::bigint[])
  `);
  const strengths = await db.execute<StrengthRow>(sql`
    select h3_r9, faction_id, strength from hex_faction_strength
    where h3_r9 = any(${ids}::bigint[]) order by h3_r9, faction_id
  `);
  const contributions = await db.execute<ContributionRow>(sql`
    select h3_r9, faction_id, user_id, meters, capped_meters, capture_bonus_m
    from hex_week_contribution
    where h3_r9 = any(${ids}::bigint[]) and week_id = ${weekId}
    order by h3_r9, faction_id, user_id
  `);
  const stateByCell = new Map(states.rows.map((row) => [bigIntToCell(row.h3_r9), row]));
  const strengthsByCell = new Map<string, FactionStrength[]>();
  for (const row of strengths.rows) {
    const cell = bigIntToCell(row.h3_r9);
    const list = strengthsByCell.get(cell) ?? [];
    list.push({ factionId: Number(row.faction_id), strength: Number(row.strength) });
    strengthsByCell.set(cell, list);
  }
  const contributionsByCell = new Map<string, RawContribution[]>();
  for (const row of contributions.rows) {
    const cell = bigIntToCell(row.h3_r9);
    const list = contributionsByCell.get(cell) ?? [];
    list.push({
      factionId: Number(row.faction_id),
      userId: row.user_id,
      meters: Number(row.meters),
      cappedMeters: Number(row.capped_meters),
      bonusMeters: Number(row.capture_bonus_m),
    });
    contributionsByCell.set(cell, list);
  }
  return cells.map((id) => {
    const cell = bigIntToCell(id);
    const state = stateByCell.get(cell);
    return {
      cell,
      exists: state !== undefined,
      owner: state?.owner_faction_id ?? null,
      ownerSinceWeek: state?.owner_since_week ?? null,
      captainBefore: state?.captain_user_id ?? null,
      lastReckonedWeek: state?.last_reckoned_week ?? null,
      lastActivityWeek: state?.last_activity_week ?? null,
      strengths: strengthsByCell.get(cell) ?? [],
      rawContributions: contributionsByCell.get(cell) ?? [],
    };
  });
}

/** Σ `capture_bonus_m` per faction — the only arithmetic of this file (R4). */
export function bonusesOf(rows: readonly RawContribution[]): ReckonBonus[] {
  const totals = new Map<number, number>();
  for (const row of rows) {
    if (!(row.bonusMeters > 0)) continue;
    totals.set(row.factionId, (totals.get(row.factionId) ?? 0) + row.bonusMeters);
  }
  return [...totals.entries()]
    .map(([factionId, meters]) => ({ factionId, meters }))
    .sort((a, b) => a.factionId - b.factionId);
}

export interface ReckonBatchOptions {
  /** Receives one line per capped row whose stored value drifted from the rules package. */
  warn?: (message: string, context: Record<string, unknown>) => void;
}

/**
 * Reckons every cell of the batch with `applyWeeklyCap` + `reckonWeek` (Constitution II: the
 * rules package is the only arithmetic). Pure and deterministic; drives the fixture test.
 */
export function reckonBatch(
  inputs: readonly CellInputs[],
  weekId: string,
  opts: ReckonBatchOptions = {},
): BatchResult {
  const outcomes: CellOutcome[] = [];
  const beneficiaries: FlipBeneficiary[] = [];
  let skipped = 0;
  let capDrift = 0;
  for (const input of inputs) {
    if (input.lastReckonedWeek === weekId) {
      skipped += 1;
      continue;
    }
    const raw: Contribution[] = input.rawContributions
      .filter((row) => row.meters > 0)
      .map((row) => ({
        cell: input.cell,
        factionId: row.factionId,
        userId: row.userId,
        meters: row.meters,
      }));
    const capped = applyWeeklyCap(raw);
    for (const row of capped) {
      const stored = input.rawContributions.find(
        (r) => r.factionId === row.factionId && r.userId === row.userId,
      );
      if (stored && Math.abs(stored.cappedMeters - row.cappedMeters) > CAP_DRIFT_TOLERANCE_M) {
        capDrift += 1;
        opts.warn?.('reckoning: stored capped_meters drifted from applyWeeklyCap', {
          cell: input.cell,
          weekId,
          factionId: row.factionId,
          userId: row.userId,
          stored: stored.cappedMeters,
          computed: row.cappedMeters,
        });
      }
    }
    const contributions: ReckonContribution[] = capped.map((row) => ({
      factionId: row.factionId,
      cappedMeters: row.cappedMeters,
      userId: row.userId,
    }));
    const result = reckonWeek({
      cell: input.cell,
      owner: input.owner,
      strengths: input.strengths,
      contributions,
      bonuses: bonusesOf(input.rawContributions),
    });
    const hadContributions = input.rawContributions.length > 0;
    const ownerSinceWeek = result.flipped
      ? result.owner === null
        ? null
        : weekId
      : input.ownerSinceWeek;
    outcomes.push({
      cell: input.cell,
      isNew: !input.exists,
      owner: input.owner,
      captainBefore: input.captainBefore,
      result,
      contributions,
      hadContributions,
      ownerSinceWeek,
      lastActivityWeek: hadContributions ? weekId : input.lastActivityWeek,
    });
    if (result.event && result.event.to !== null) {
      const to = result.event.to;
      const seen = new Set<string>();
      for (const c of contributions) {
        if (c.factionId !== to || c.userId === undefined || !(c.cappedMeters > 0)) continue;
        if (seen.has(c.userId)) continue;
        seen.add(c.userId);
        beneficiaries.push({ cell: input.cell, userId: c.userId, factionId: to });
      }
    }
  }
  return { outcomes, beneficiaries, skipped, capDrift };
}

/** Convenience for callers holding string cells. */
export function cellIds(cells: readonly string[]): bigint[] {
  return cells.map(cellToBigInt);
}
