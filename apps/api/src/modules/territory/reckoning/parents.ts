import { deriveParentOwner } from '@nature/territory-rules';
import { sql } from 'drizzle-orm';
import type { DbLike } from '../../../db/client.js';
import type { ConsistencyDrift } from '../../../db/schema/index.js';
import { bigIntToCell, cellPolygonWkt, cellToBigInt, parentsOf } from '../../../lib/h3.js';
import { CONSISTENCY_SAMPLE_SIZE } from '../limits.js';
import type { CellOutcome } from './cells.js';

/**
 * Res 8–5 parents (docs/territory-rules.md "Parent ownership", specs/004-weekly-reckoning/
 * research.md R6). `hex_parent_state.child_owner_counts` is `{ "<factionId>": <claimed children
 * owned by it> }`; the owner is always derived through the rules package's
 * `deriveParentOwner` over the expanded counts (Constitution II).
 */
export type ParentCounts = Record<string, number>;

export const PARENT_RESOLUTIONS = [8, 7, 6, 5] as const;

/** Drops zero entries and sorts keys so two count maps compare structurally. */
export function normalizeCounts(counts: ParentCounts): ParentCounts {
  const result: ParentCounts = {};
  for (const key of Object.keys(counts).sort((a, b) => Number(a) - Number(b))) {
    const value = counts[key] ?? 0;
    if (value > 0) result[key] = value;
  }
  return result;
}

export function claimedOf(counts: ParentCounts): number {
  let claimed = 0;
  for (const value of Object.values(counts)) claimed += value;
  return claimed;
}

/** `deriveParentOwner` over the counts expanded to one entry per claimed child. */
export function ownerFromCounts(counts: ParentCounts): number | null {
  const children: number[] = [];
  for (const [faction, count] of Object.entries(counts)) {
    for (let i = 0; i < count; i += 1) children.push(Number(faction));
  }
  return deriveParentOwner(children);
}

export interface ParentDelta {
  h3: string;
  res: number;
  /** `factionId → ±claimed children`. */
  deltas: Map<number, number>;
}

/** One delta per touched parent: every res-9 flip touches exactly one parent per level. */
export function collectParentDeltas(outcomes: readonly CellOutcome[]): Map<string, ParentDelta> {
  const result = new Map<string, ParentDelta>();
  for (const outcome of outcomes) {
    const event = outcome.result.event;
    if (!event) continue;
    const parents = parentsOf(outcome.cell);
    const perLevel: [number, string][] = [
      [8, parents.r8],
      [7, parents.r7],
      [6, parents.r6],
      [5, parents.r5],
    ];
    for (const [res, h3] of perLevel) {
      const entry = result.get(h3) ?? { h3, res, deltas: new Map<number, number>() };
      if (event.from !== null)
        entry.deltas.set(event.from, (entry.deltas.get(event.from) ?? 0) - 1);
      if (event.to !== null) entry.deltas.set(event.to, (entry.deltas.get(event.to) ?? 0) + 1);
      result.set(h3, entry);
    }
  }
  return result;
}

export class ParentCountError extends Error {
  constructor(
    readonly h3: string,
    readonly factionId: number,
    readonly count: number,
  ) {
    super(
      `parent ${h3}: claimed-children count of faction ${String(factionId)} would become ${String(count)}`,
    );
    this.name = 'ParentCountError';
  }
}

export interface ParentRow {
  h3: string;
  res: number;
  owner: number | null;
  counts: ParentCounts;
  claimed: number;
  /** The row exists in `hex_parent_state`. */
  exists: boolean;
}

export interface ParentFlip {
  h3: string;
  res: number;
  from: number | null;
  to: number | null;
}

type ParentDbRow = {
  h3: string;
  res: number;
  owner_faction_id: number | null;
  child_owner_counts: ParentCounts;
  claimed_children: number;
};

/** Loads the stored rows of `ids` (locked with `FOR UPDATE` inside a writing transaction). */
export async function loadParentRows(
  db: DbLike,
  ids: readonly string[],
  opts: { forUpdate: boolean },
): Promise<Map<string, ParentRow>> {
  const result = new Map<string, ParentRow>();
  if (ids.length === 0) return result;
  const param = sql.param(ids.map((h3) => cellToBigInt(h3).toString()));
  const lock = opts.forUpdate ? sql`for update` : sql``;
  const rows = await db.execute<ParentDbRow>(sql`
    select h3, res, owner_faction_id, child_owner_counts, claimed_children
    from hex_parent_state where h3 = any(${param}::bigint[]) order by h3 ${lock}
  `);
  for (const row of rows.rows) {
    result.set(bigIntToCell(row.h3), {
      h3: bigIntToCell(row.h3),
      res: Number(row.res),
      owner: row.owner_faction_id,
      counts: normalizeCounts(row.child_owner_counts),
      claimed: Number(row.claimed_children),
      exists: true,
    });
  }
  return result;
}

/**
 * Applies the deltas to the rows (pure). A count that would go negative is a bug and throws
 * `ParentCountError` so the batch aborts (FR-006). Returns the updated rows and the flips.
 */
export function applyDeltasToRows(
  rows: ReadonlyMap<string, ParentRow>,
  deltas: ReadonlyMap<string, ParentDelta>,
): { rows: ParentRow[]; flips: ParentFlip[] } {
  const updated: ParentRow[] = [];
  const flips: ParentFlip[] = [];
  for (const delta of deltas.values()) {
    const before = rows.get(delta.h3) ?? {
      h3: delta.h3,
      res: delta.res,
      owner: null,
      counts: {},
      claimed: 0,
      exists: false,
    };
    const counts: ParentCounts = { ...before.counts };
    for (const [factionId, change] of delta.deltas) {
      const next = (counts[String(factionId)] ?? 0) + change;
      if (next < 0) throw new ParentCountError(delta.h3, factionId, next);
      counts[String(factionId)] = next;
    }
    const normalized = normalizeCounts(counts);
    const owner = ownerFromCounts(normalized);
    if (owner !== before.owner)
      flips.push({ h3: delta.h3, res: delta.res, from: before.owner, to: owner });
    updated.push({
      h3: delta.h3,
      res: delta.res,
      owner,
      counts: normalized,
      claimed: claimedOf(normalized),
      exists: before.exists,
    });
  }
  return { rows: updated, flips };
}

/** Set-based upsert of parent rows; `geom` and `res` only matter for rows that do not exist yet. */
export async function writeParentRows(
  db: DbLike,
  rows: readonly ParentRow[],
  now: Date,
): Promise<void> {
  if (rows.length === 0) return;
  await db.execute(sql`
    insert into hex_parent_state (h3, res, geom, owner_faction_id, child_owner_counts, claimed_children, updated_at)
    select h3, res, ST_GeomFromText(wkt, 4326), owner, counts::jsonb, claimed, ${now}
    from unnest(
      ${sql.param(rows.map((row) => cellToBigInt(row.h3).toString()))}::bigint[],
      ${sql.param(rows.map((row) => row.res))}::smallint[],
      ${sql.param(rows.map((row) => cellPolygonWkt(row.h3)))}::text[],
      ${sql.param(rows.map((row) => row.owner))}::smallint[],
      ${sql.param(rows.map((row) => JSON.stringify(row.counts)))}::text[],
      ${sql.param(rows.map((row) => row.claimed))}::integer[]
    ) as r(h3, res, wkt, owner, counts, claimed)
    on conflict (h3) do update set
      owner_faction_id = excluded.owner_faction_id,
      child_owner_counts = excluded.child_owner_counts,
      claimed_children = excluded.claimed_children,
      updated_at = excluded.updated_at
  `);
}

export interface ApplyParentDeltasOptions {
  /**
   * Dry run: rows are read without locks, never written, and the updated copies are kept in this
   * map so later batches of the same preview see them (research.md R13).
   */
  preview?: Map<string, ParentRow>;
}

/** Stage `cells` parent update for one batch: load `FOR UPDATE`, apply, upsert (R6). */
export async function applyParentDeltas(
  db: DbLike,
  deltas: ReadonlyMap<string, ParentDelta>,
  now: Date,
  opts: ApplyParentDeltasOptions = {},
): Promise<{ parentFlips: number; flips: ParentFlip[] }> {
  if (deltas.size === 0) return { parentFlips: 0, flips: [] };
  const ids = [...deltas.keys()];
  const stored = await loadParentRows(db, ids, { forUpdate: opts.preview === undefined });
  if (opts.preview) {
    for (const [h3, row] of opts.preview) if (deltas.has(h3)) stored.set(h3, row);
  }
  const { rows, flips } = applyDeltasToRows(stored, deltas);
  if (opts.preview) {
    for (const row of rows) opts.preview.set(row.h3, { ...row, exists: true });
  } else {
    await writeParentRows(db, rows, now);
  }
  return { parentFlips: flips.length, flips };
}

export interface ConsistencyReport {
  parentsChecked: number;
  drifted: number;
  repaired: number;
  byRes: Record<number, { checked: number; drifted: number; repaired: number }>;
  sample: ConsistencyDrift[];
}

type ExpectedRow = { h3: string; owner_faction_id: number; n: string | number };
type StoredRow = {
  h3: string;
  owner_faction_id: number | null;
  child_owner_counts: ParentCounts;
  claimed_children: number;
};

/**
 * Re-derives every parent from `hex_state` grouped per level (index-only on `h3_r8..r5`),
 * compares with the stored rows and reports drift; upserts the recomputed rows only with
 * `repair` (research.md R6, FR-016). Never touches res-9 rows.
 */
export async function recomputeParents(
  db: DbLike,
  opts: { repair: boolean; sampleSize?: number; now?: Date },
): Promise<ConsistencyReport> {
  const sampleSize = opts.sampleSize ?? CONSISTENCY_SAMPLE_SIZE;
  const now = opts.now ?? new Date();
  const report: ConsistencyReport = {
    parentsChecked: 0,
    drifted: 0,
    repaired: 0,
    byRes: {},
    sample: [],
  };
  for (const res of PARENT_RESOLUTIONS) {
    const column = sql.identifier(`h3_r${String(res)}`);
    const expectedRows = await db.execute<ExpectedRow>(sql`
      select ${column} as h3, owner_faction_id, count(*) as n from hex_state
      where owner_faction_id is not null group by ${column}, owner_faction_id
    `);
    const expected = new Map<string, ParentCounts>();
    for (const row of expectedRows.rows) {
      const h3 = bigIntToCell(row.h3);
      const counts = expected.get(h3) ?? {};
      counts[String(row.owner_faction_id)] = Number(row.n);
      expected.set(h3, counts);
    }
    const storedRows = await db.execute<StoredRow>(sql`
      select h3, owner_faction_id, child_owner_counts, claimed_children
      from hex_parent_state where res = ${res}
    `);
    const stored = new Map(storedRows.rows.map((row) => [bigIntToCell(row.h3), row]));

    const drifts: { drift: ConsistencyDrift; row: ParentRow }[] = [];
    const all = new Set([...expected.keys(), ...stored.keys()]);
    for (const h3 of all) {
      const expectedCounts = normalizeCounts(expected.get(h3) ?? {});
      const expectedOwner = ownerFromCounts(expectedCounts);
      const storedRow = stored.get(h3);
      const actualCounts = normalizeCounts(storedRow?.child_owner_counts ?? {});
      const actualOwner = storedRow?.owner_faction_id ?? null;
      let kind: ConsistencyDrift['kind'] | null = null;
      if (!storedRow) {
        if (claimedOf(expectedCounts) > 0) kind = 'missing';
      } else if (claimedOf(expectedCounts) === 0 && Number(storedRow.claimed_children) > 0) {
        kind = 'extra';
      } else if (expectedOwner !== actualOwner) {
        kind = 'owner';
      } else if (
        JSON.stringify(expectedCounts) !== JSON.stringify(actualCounts) ||
        Number(storedRow.claimed_children) !== claimedOf(expectedCounts)
      ) {
        kind = 'counts';
      }
      if (kind === null) continue;
      drifts.push({
        drift: { h3, res, kind, expectedOwner, actualOwner, expectedCounts, actualCounts },
        row: {
          h3,
          res,
          owner: expectedOwner,
          counts: expectedCounts,
          claimed: claimedOf(expectedCounts),
          exists: storedRow !== undefined,
        },
      });
    }
    let repaired = 0;
    if (opts.repair && drifts.length > 0) {
      await writeParentRows(
        db,
        drifts.map((d) => d.row),
        now,
      );
      repaired = drifts.length;
    }
    report.byRes[res] = { checked: all.size, drifted: drifts.length, repaired };
    report.parentsChecked += all.size;
    report.drifted += drifts.length;
    report.repaired += repaired;
    for (const d of drifts) {
      if (report.sample.length < sampleSize) report.sample.push(d.drift);
    }
  }
  return report;
}
