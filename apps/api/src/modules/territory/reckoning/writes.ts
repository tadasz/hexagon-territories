import { sql } from 'drizzle-orm';
import type { DbLike } from '../../../db/client.js';
import { bigIntToCell, cellPolygonWkt, cellToBigInt, parentsOf } from '../../../lib/h3.js';
import { HEX_FLIP_XP } from '../limits.js';
import type { CellOutcome, FlipBeneficiary } from './cells.js';

/**
 * Set-based writes of one reckoning batch (specs/004-weekly-reckoning/research.md R5, plan.md
 * Shared Semantics 3–5). Every statement takes `unnest` arrays so a 1 000-cell batch costs a
 * handful of round trips. Runs inside the batch transaction; the caller adds the parent deltas
 * and the cursor update. This is the only code that writes `hex_state.owner_faction_id`
 * (Constitution II).
 */
export interface WriteBatchResult {
  cells: number;
  flips: number;
  /** Ledger rows actually inserted (a retried batch inserts none twice). */
  xpRows: number;
  /** `hex_ownership_events.id` per flipped cell. */
  eventIds: Map<string, number>;
}

const ids = (cells: readonly string[]) => sql.param(cells.map((c) => cellToBigInt(c).toString()));

/** Upsert of the new strengths, and deletion of factions the rules package dropped. */
async function writeStrengths(
  db: DbLike,
  weekId: string,
  outcomes: readonly CellOutcome[],
): Promise<void> {
  const cells: string[] = [];
  const factions: number[] = [];
  const strengths: number[] = [];
  for (const o of outcomes) {
    for (const s of o.result.strengths) {
      cells.push(o.cell);
      factions.push(s.factionId);
      strengths.push(s.strength);
    }
  }
  if (cells.length > 0) {
    await db.execute(sql`
      insert into hex_faction_strength (h3_r9, faction_id, strength, last_reckoned_week)
      select h3, faction, strength, ${weekId}
      from unnest(${ids(cells)}::bigint[], ${sql.param(factions)}::smallint[], ${sql.param(strengths)}::real[])
        as r(h3, faction, strength)
      on conflict (h3_r9, faction_id) do update set
        strength = excluded.strength, last_reckoned_week = excluded.last_reckoned_week
    `);
  }
  await db.execute(sql`
    delete from hex_faction_strength s
    where s.h3_r9 = any(${ids(outcomes.map((o) => o.cell))}::bigint[])
      and not exists (
        select 1 from unnest(${ids(cells)}::bigint[], ${sql.param(factions)}::smallint[]) as k(h3, faction)
        where k.h3 = s.h3_r9 and k.faction = s.faction_id
      )
  `);
}

/** One upsert: first-seen cells get parents and polygon; every cell gets the new ownership. */
async function writeStates(
  db: DbLike,
  weekId: string,
  outcomes: readonly CellOutcome[],
): Promise<void> {
  const parents = outcomes.map((o) => parentsOf(o.cell));
  await db.execute(sql`
    insert into hex_state (h3_r9, h3_r8, h3_r7, h3_r6, h3_r5, geom, owner_faction_id, owner_since_week,
                           captain_user_id, last_reckoned_week, last_activity_week, version)
    select h3, r8, r7, r6, r5, ST_GeomFromText(wkt, 4326), owner, since, captain, ${weekId}, activity, 0
    from unnest(
      ${ids(outcomes.map((o) => o.cell))}::bigint[],
      ${ids(parents.map((p) => p.r8))}::bigint[],
      ${ids(parents.map((p) => p.r7))}::bigint[],
      ${ids(parents.map((p) => p.r6))}::bigint[],
      ${ids(parents.map((p) => p.r5))}::bigint[],
      ${sql.param(outcomes.map((o) => (o.isNew ? cellPolygonWkt(o.cell) : 'POLYGON EMPTY')))}::text[],
      ${sql.param(outcomes.map((o) => o.result.owner))}::smallint[],
      ${sql.param(outcomes.map((o) => o.ownerSinceWeek))}::text[],
      ${sql.param(outcomes.map((o) => o.result.captain))}::uuid[],
      ${sql.param(outcomes.map((o) => o.lastActivityWeek))}::text[]
    ) as r(h3, r8, r7, r6, r5, wkt, owner, since, captain, activity)
    on conflict (h3_r9) do update set
      owner_faction_id = excluded.owner_faction_id,
      owner_since_week = excluded.owner_since_week,
      captain_user_id = excluded.captain_user_id,
      last_reckoned_week = excluded.last_reckoned_week,
      last_activity_week = excluded.last_activity_week,
      version = hex_state.version + 1
  `);
}

/**
 * One `hex_ownership_events` row per flip. A cell that already has a reckoning event for the
 * week keeps it (its id is the ledger's `ref_id`), so retrying a batch never duplicates events
 * or flip XP.
 */
async function writeEvents(
  db: DbLike,
  weekId: string,
  outcomes: readonly CellOutcome[],
  now: Date,
): Promise<Map<string, number>> {
  const flipped = outcomes.filter((o) => o.result.event !== undefined);
  const eventIds = new Map<string, number>();
  if (flipped.length === 0) return eventIds;
  const existing = await db.execute<{ id: string | number; h3_r9: string }>(sql`
    select id, h3_r9 from hex_ownership_events
    where week_id = ${weekId} and cause = 'reckoning'
      and h3_r9 = any(${ids(flipped.map((o) => o.cell))}::bigint[])
  `);
  for (const row of existing.rows) eventIds.set(bigIntToCell(row.h3_r9), Number(row.id));
  const missing = flipped.filter((o) => !eventIds.has(o.cell));
  if (missing.length === 0) return eventIds;
  const rows = await db.execute<{ id: string | number; h3_r9: string }>(sql`
    insert into hex_ownership_events (h3_r9, week_id, from_faction, to_faction, cause, at)
    select h3, ${weekId}, f, t, 'reckoning', ${now}
    from unnest(
      ${ids(missing.map((o) => o.cell))}::bigint[],
      ${sql.param(missing.map((o) => o.result.event!.from))}::smallint[],
      ${sql.param(missing.map((o) => o.result.event!.to))}::smallint[]
    ) as r(h3, f, t)
    returning id, h3_r9
  `);
  for (const row of rows.rows) {
    eventIds.set(bigIntToCell(row.h3_r9), Number(row.id));
  }
  return eventIds;
}

async function writeHistory(
  db: DbLike,
  weekId: string,
  outcomes: readonly CellOutcome[],
  now: Date,
): Promise<void> {
  await db.execute(sql`
    insert into hex_reckoning_history (h3_r9, week_id, owner_faction_id, flipped, from_faction, to_faction,
                                       captain_user_id, captain_before_user_id, strengths, had_contributions, reckoned_at)
    select h3, ${weekId}, owner, flipped, f, t, captain, before, strengths::jsonb, had, ${now}
    from unnest(
      ${ids(outcomes.map((o) => o.cell))}::bigint[],
      ${sql.param(outcomes.map((o) => o.result.owner))}::smallint[],
      ${sql.param(outcomes.map((o) => o.result.flipped))}::boolean[],
      ${sql.param(outcomes.map((o) => o.result.event?.from ?? null))}::smallint[],
      ${sql.param(outcomes.map((o) => o.result.event?.to ?? null))}::smallint[],
      ${sql.param(outcomes.map((o) => o.result.captain))}::uuid[],
      ${sql.param(outcomes.map((o) => o.captainBefore))}::uuid[],
      ${sql.param(outcomes.map((o) => JSON.stringify(o.result.strengths)))}::text[],
      ${sql.param(outcomes.map((o) => o.hadContributions))}::boolean[]
    ) as r(h3, owner, flipped, f, t, captain, before, strengths, had)
    on conflict (h3_r9, week_id) do update set
      owner_faction_id = excluded.owner_faction_id,
      flipped = excluded.flipped,
      from_faction = excluded.from_faction,
      to_faction = excluded.to_faction,
      captain_user_id = excluded.captain_user_id,
      captain_before_user_id = excluded.captain_before_user_id,
      strengths = excluded.strengths,
      had_contributions = excluded.had_contributions,
      reckoned_at = excluded.reckoned_at
  `);
}

/** Flip XP: one `hex_flip` ledger row per beneficiary (idempotent) and `users.xp` increments. */
async function writeFlipXp(
  db: DbLike,
  weekId: string,
  beneficiaries: readonly FlipBeneficiary[],
  eventIds: ReadonlyMap<string, number>,
  now: Date,
): Promise<number> {
  const rows = beneficiaries.filter((b) => eventIds.has(b.cell));
  if (rows.length === 0) return 0;
  const inserted = await db.execute<{ user_id: string; points: number }>(sql`
    with ins as (
      insert into points_ledger (user_id, faction_id, kind, points, ref_type, ref_id, h3_r9, week_id, created_at)
      select u, f, 'hex_flip', ${HEX_FLIP_XP}, 'hex_ownership_event', ref, h3, ${weekId}, ${now}
      from unnest(
        ${sql.param(rows.map((b) => b.userId))}::uuid[],
        ${sql.param(rows.map((b) => b.factionId))}::smallint[],
        ${sql.param(rows.map((b) => String(eventIds.get(b.cell))))}::text[],
        ${ids(rows.map((b) => b.cell))}::bigint[]
      ) as r(u, f, ref, h3)
      on conflict (user_id, ref_id) where kind = 'hex_flip' do nothing
      returning user_id, points
    ),
    totals as (select user_id, sum(points)::integer as total from ins group by user_id),
    bump as (
      update users set xp = users.xp + totals.total from totals where users.id = totals.user_id
      returning users.id
    )
    select user_id, points from ins
  `);
  return inserted.rows.length;
}

/** Every write of one batch except parents and the cursor (R5). */
export async function writeBatch(
  db: DbLike,
  weekId: string,
  outcomes: readonly CellOutcome[],
  beneficiaries: readonly FlipBeneficiary[],
  now: Date,
): Promise<WriteBatchResult> {
  if (outcomes.length === 0) return { cells: 0, flips: 0, xpRows: 0, eventIds: new Map() };
  await writeStrengths(db, weekId, outcomes);
  await writeStates(db, weekId, outcomes);
  const eventIds = await writeEvents(db, weekId, outcomes, now);
  await writeHistory(db, weekId, outcomes, now);
  const xpRows = await writeFlipXp(db, weekId, beneficiaries, eventIds, now);
  return { cells: outcomes.length, flips: eventIds.size, xpRows, eventIds };
}

/** Advances the resume cursor and the counters of the `reckonings` row in the same transaction. */
export async function advanceCursor(
  db: DbLike,
  weekId: string,
  cursor: bigint,
  counts: { cells: number; flips: number; parentFlips: number },
): Promise<void> {
  await db.execute(sql`
    update reckonings set
      cursor_h3_r9 = ${cursor.toString()}::bigint,
      batches = batches + 1,
      hexes_processed = hexes_processed + ${counts.cells},
      flips = flips + ${counts.flips},
      parent_flips = parent_flips + ${counts.parentFlips}
    where week_id = ${weekId}
  `);
}
