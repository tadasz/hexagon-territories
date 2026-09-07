import { createHash } from 'node:crypto';
import type { ReckoningWeeksFixture } from '@nature/h3-fixtures';
import { RULES } from '@nature/territory-rules';
import { sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { gridDisk } from 'h3-js';
import pg from 'pg';
import pino from 'pino';
import type { Pool } from '../../src/db/client.js';
import { hexFactionStrength, hexWeekContribution, users } from '../../src/db/schema/index.js';
import { cellPolygonWkt, cellToBigInt, parentsOf } from '../../src/lib/h3.js';
import { RECKONING_LOCK_KEY } from '../../src/modules/territory/limits.js';
import {
  runReckoning,
  type ReckoningDeps,
  type ReckoningRunResult,
} from '../../src/modules/territory/reckoning/run.js';
import { weekEndUtc } from '../../src/modules/territory/weeks.js';
import type { FakeClock } from './clock.js';
import type { TestDatabase } from './db.js';

/** Test helpers of specs/004-weekly-reckoning/data-model.md §5 (research.md R19). */

/** A deterministic UUID for a fixture user id so two databases seed identical rows. */
export function uuidFromName(name: string): string {
  const hex = createHash('sha1').update(`nature-explorer:${name}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** The synthetic user carrying a faction's capture bonuses (`capture_bonus_m` rows). */
export function bonusUserName(factionId: number): string {
  return `bonus-f${String(factionId)}`;
}

/** Week before the fixture's first week: the seeded `last_reckoned_week` of initial states. */
export const FIXTURE_INITIAL_WEEK = '2026-W34';

export interface SeededFixture {
  /** fixture user id → users.id */
  users: Map<string, string>;
  /** faction id → the bonus user's id */
  bonusUsers: Map<number, string>;
}

/**
 * Seeds `reckoning-weeks.json`: one user per fixture id (faction of their first contribution),
 * one bonus user per faction, the initial strengths/states (`last_reckoned_week = 2026-W34`)
 * and every week's contributions (`capped_meters = min(meters, cap)`, bonuses on the bonus
 * user's row). Weeks are seeded up front — the reckoning of W35 only reads W35 rows.
 */
export async function seedFixtureWeeks(
  tdb: TestDatabase,
  fixture: ReckoningWeeksFixture,
  opts: { weeks?: readonly string[] } = {},
): Promise<SeededFixture> {
  const factionOfUser = new Map<string, number>();
  for (const cell of fixture.cells) {
    for (const week of cell.weeks) {
      for (const c of week.contributions) {
        if (!factionOfUser.has(c.userId)) factionOfUser.set(c.userId, c.factionId);
      }
    }
  }
  const userIds = new Map<string, string>();
  for (const [name, factionId] of [...factionOfUser.entries()].sort()) {
    const id = uuidFromName(name);
    await tdb.db
      .insert(users)
      .values({ id, appleSub: `fixture-${name}`, displayName: `Fixture ${name}`, factionId })
      .onConflictDoNothing();
    userIds.set(name, id);
  }
  const bonusUsers = new Map<number, string>();
  for (const factionId of fixture.factions) {
    const id = uuidFromName(bonusUserName(factionId));
    await tdb.db
      .insert(users)
      .values({
        id,
        appleSub: `fixture-${bonusUserName(factionId)}`,
        displayName: `Bonus ${String(factionId)}`,
        factionId,
      })
      .onConflictDoNothing();
    bonusUsers.set(factionId, id);
  }

  const weeks = opts.weeks ?? fixture.weeks;
  for (const cell of fixture.cells) {
    const h3 = cellToBigInt(cell.cell);
    if (cell.initial.strengths.length > 0) {
      await tdb.db.insert(hexFactionStrength).values(
        cell.initial.strengths.map((s) => ({
          h3R9: h3,
          factionId: s.factionId,
          strength: s.strength,
          lastReckonedWeek: FIXTURE_INITIAL_WEEK,
        })),
      );
    }
    for (const week of cell.weeks) {
      if (!weeks.includes(week.weekId)) continue;
      const byKey = new Map<
        string,
        { factionId: number; userId: string; meters: number; bonus: number }
      >();
      for (const c of week.contributions) {
        const key = `${String(c.factionId)}:${c.userId}`;
        const row = byKey.get(key) ?? {
          factionId: c.factionId,
          userId: userIds.get(c.userId)!,
          meters: 0,
          bonus: 0,
        };
        row.meters += c.meters;
        byKey.set(key, row);
      }
      for (const b of week.bonuses) {
        const key = `${String(b.factionId)}:bonus`;
        const row = byKey.get(key) ?? {
          factionId: b.factionId,
          userId: bonusUsers.get(b.factionId)!,
          meters: 0,
          bonus: 0,
        };
        row.bonus += b.meters;
        byKey.set(key, row);
      }
      for (const row of byKey.values()) {
        await tdb.db.insert(hexWeekContribution).values({
          h3R9: h3,
          weekId: week.weekId,
          factionId: row.factionId,
          userId: row.userId,
          meters: row.meters,
          cappedMeters: Math.min(row.meters, RULES.WEEKLY_CAP_M_PER_PLAYER_PER_CELL),
          captureBonusM: row.bonus,
          walks: row.meters > 0 ? 1 : 0,
        });
      }
    }
  }
  return { users: userIds, bonusUsers };
}

export function silentLogger(): FastifyBaseLogger {
  return pino({ level: 'silent' });
}

export interface FixtureDepsOptions {
  batchSize?: number;
  boss?: ReckoningDeps['boss'];
  log?: FastifyBaseLogger;
  autofinish?: ReckoningDeps['autofinish'];
  countStaleWalks?: ReckoningDeps['countStaleWalks'];
  hooks?: ReckoningDeps['hooks'];
}

/** Reckoning deps over a test database and a fake clock (no autofinish unless given). */
export function reckoningDeps(
  tdb: TestDatabase,
  clock: FakeClock,
  opts: FixtureDepsOptions = {},
): ReckoningDeps {
  return {
    db: tdb.db,
    pool: tdb.pool,
    boss: opts.boss ?? null,
    clock,
    log: opts.log ?? silentLogger(),
    batchSize: opts.batchSize ?? 1000,
    ...(opts.autofinish ? { autofinish: opts.autofinish } : {}),
    ...(opts.countStaleWalks ? { countStaleWalks: opts.countStaleWalks } : {}),
    ...(opts.hooks ? { hooks: opts.hooks } : {}),
  };
}

/** Sets the clock to one second after the week ended and runs the reckoning synchronously. */
export async function runFixtureWeek(
  deps: ReckoningDeps,
  weekId: string,
  clock: FakeClock,
  opts: { dryRun?: boolean } = {},
): Promise<ReckoningRunResult> {
  clock.set(new Date(weekEndUtc(weekId).getTime() + 1_000));
  return runReckoning(deps, { weekId, ...(opts.dryRun ? { dryRun: true } : {}) });
}

export const SNAPSHOT_TABLES = [
  'hex_faction_strength',
  'hex_state',
  'hex_ownership_events',
  'hex_parent_state',
  'hex_reckoning_history',
  'points_ledger',
  'leaderboard_snapshots',
  'faction_stats_weekly',
  'reckonings',
  'users',
] as const;

const ORDER_BY: Record<(typeof SNAPSHOT_TABLES)[number], string> = {
  hex_faction_strength: 'h3_r9, faction_id',
  hex_state: 'h3_r9',
  hex_ownership_events: 'h3_r9, week_id',
  hex_parent_state: 'h3',
  hex_reckoning_history: 'h3_r9, week_id',
  points_ledger: 'week_id, user_id, kind, h3_r9',
  leaderboard_snapshots: 'week_id, scope, scope_id, rank',
  faction_stats_weekly: 'week_id, faction_id',
  reckonings: 'week_id',
  users: 'apple_sub',
};

/** Columns that legitimately differ between two otherwise identical runs. */
const VOLATILE_COLUMNS = new Set([
  'id',
  'ref_id',
  'at',
  'updated_at',
  'computed_at',
  'reckoned_at',
  'started_at',
  'finished_at',
  'created_at',
  'last_seen_at',
  'attempt',
  'error',
]);

/** Ordered rows of the 004 tables without volatile columns, for row-for-row comparison. */
export async function tableSnapshot(
  tdb: TestDatabase,
  tables: readonly (typeof SNAPSHOT_TABLES)[number][] = SNAPSHOT_TABLES,
): Promise<Record<string, Record<string, unknown>[]>> {
  const snapshot: Record<string, Record<string, unknown>[]> = {};
  for (const table of tables) {
    const { rows } = await tdb.pool.query<Record<string, unknown>>(
      `select * from ${table} order by ${ORDER_BY[table]}`,
    );
    snapshot[table] = rows.map((row) => {
      const copy: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (!VOLATILE_COLUMNS.has(key)) copy[key] = value;
      }
      return copy;
    });
  }
  return snapshot;
}

export interface GridSeedOptions {
  factions: readonly number[];
  users: readonly string[];
  weekId: string;
  /** Contributions per cell go to this many users (round robin); default every user. */
  strengthPerFaction?: number;
}

/**
 * Seeds `gridDisk(centre, k)` cells with strengths for the given factions and one contribution
 * per user per cell for `weekId` (metres vary per cell so some flip and some do not). Returns
 * the number of cells. The users must exist.
 */
export async function gridSeed(
  tdb: TestDatabase,
  centre: string,
  k: number,
  opts: GridSeedOptions,
): Promise<number> {
  const cells = gridDisk(centre, k);
  const ids = cells.map((cell) => cellToBigInt(cell).toString());
  const strengthRows: { h3: string; faction: number; strength: number }[] = [];
  const contributionRows: { h3: string; faction: number; user: string; meters: number }[] = [];
  cells.forEach((_, i) => {
    opts.factions.forEach((factionId, f) => {
      strengthRows.push({
        h3: ids[i]!,
        faction: factionId,
        strength: 400 + ((i * 37 + f * 250) % 1500),
      });
    });
    opts.users.forEach((userId, u) => {
      contributionRows.push({
        h3: ids[i]!,
        faction: opts.factions[u % opts.factions.length]!,
        user: userId,
        meters: 100 + ((i * 53 + u * 700) % 2400),
      });
    });
  });
  const chunk = 5_000;
  for (let i = 0; i < strengthRows.length; i += chunk) {
    const part = strengthRows.slice(i, i + chunk);
    await tdb.db.execute(sql`
      insert into hex_faction_strength (h3_r9, faction_id, strength, last_reckoned_week)
      select h3, faction, strength, ${FIXTURE_INITIAL_WEEK}
      from unnest(${sql.param(part.map((r) => r.h3))}::bigint[], ${sql.param(part.map((r) => r.faction))}::smallint[],
                  ${sql.param(part.map((r) => r.strength))}::real[]) as r(h3, faction, strength)
    `);
  }
  for (let i = 0; i < contributionRows.length; i += chunk) {
    const part = contributionRows.slice(i, i + chunk);
    await tdb.db.execute(sql`
      insert into hex_week_contribution (h3_r9, week_id, faction_id, user_id, meters, capped_meters, walks)
      select h3, ${opts.weekId}, faction, u, meters, least(meters, ${RULES.WEEKLY_CAP_M_PER_PLAYER_PER_CELL}), 1
      from unnest(${sql.param(part.map((r) => r.h3))}::bigint[], ${sql.param(part.map((r) => r.faction))}::smallint[],
                  ${sql.param(part.map((r) => r.user))}::uuid[], ${sql.param(part.map((r) => r.meters))}::real[])
        as r(h3, faction, u, meters)
    `);
  }
  return cells.length;
}

export interface StateSeed {
  cell: string;
  owner: number | null;
  ownerSince?: string | null;
  captain?: string | null;
  lastReckonedWeek?: string | null;
}

/** Bulk-inserts `hex_state` rows with parents and polygons computed by the API (no reckoning). */
export async function seedStates(tdb: TestDatabase, rows: readonly StateSeed[]): Promise<void> {
  const chunk = 2_000;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const parents = part.map((r) => parentsOf(r.cell));
    await tdb.db.execute(sql`
      insert into hex_state (h3_r9, h3_r8, h3_r7, h3_r6, h3_r5, geom, owner_faction_id, owner_since_week, captain_user_id, last_reckoned_week)
      select h3, r8, r7, r6, r5, ST_GeomFromText(wkt, 4326), owner, since, captain, reckoned
      from unnest(
        ${sql.param(part.map((r) => cellToBigInt(r.cell).toString()))}::bigint[],
        ${sql.param(parents.map((p) => cellToBigInt(p.r8).toString()))}::bigint[],
        ${sql.param(parents.map((p) => cellToBigInt(p.r7).toString()))}::bigint[],
        ${sql.param(parents.map((p) => cellToBigInt(p.r6).toString()))}::bigint[],
        ${sql.param(parents.map((p) => cellToBigInt(p.r5).toString()))}::bigint[],
        ${sql.param(part.map((r) => cellPolygonWkt(r.cell)))}::text[],
        ${sql.param(part.map((r) => r.owner))}::smallint[],
        ${sql.param(part.map((r) => r.ownerSince ?? null))}::text[],
        ${sql.param(part.map((r) => r.captain ?? null))}::uuid[],
        ${sql.param(part.map((r) => r.lastReckonedWeek ?? FIXTURE_INITIAL_WEEK))}::text[]
      ) as r(h3, r8, r7, r6, r5, wkt, owner, since, captain, reckoned)
      on conflict (h3_r9) do nothing
    `);
  }
}

export interface ParentSeed {
  h3: string;
  res: number;
  owner: number | null;
  counts: Record<string, number>;
}

/** Bulk-inserts `hex_parent_state` rows with polygons computed by the API. */
export async function seedParents(tdb: TestDatabase, rows: readonly ParentSeed[]): Promise<void> {
  if (rows.length === 0) return;
  await tdb.db.execute(sql`
    insert into hex_parent_state (h3, res, geom, owner_faction_id, child_owner_counts, claimed_children)
    select h3, res, ST_GeomFromText(wkt, 4326), owner, counts::jsonb, claimed
    from unnest(
      ${sql.param(rows.map((r) => cellToBigInt(r.h3).toString()))}::bigint[],
      ${sql.param(rows.map((r) => r.res))}::smallint[],
      ${sql.param(rows.map((r) => cellPolygonWkt(r.h3)))}::text[],
      ${sql.param(rows.map((r) => r.owner))}::smallint[],
      ${sql.param(rows.map((r) => JSON.stringify(r.counts)))}::text[],
      ${sql.param(rows.map((r) => Object.values(r.counts).reduce((a, b) => a + b, 0)))}::integer[]
    ) as r(h3, res, wkt, owner, counts, claimed)
    on conflict (h3) do nothing
  `);
}

/** Inserts a plain user row directly (no sign-in) and returns its id. */
export async function seedUser(
  tdb: TestDatabase,
  name: string,
  factionId: number | null,
  role: 'player' | 'tester' | 'admin' = 'player',
): Promise<string> {
  const id = uuidFromName(name);
  await tdb.db
    .insert(users)
    .values({ id, appleSub: `seed-${name}`, displayName: name, factionId, role })
    .onConflictDoNothing();
  return id;
}

/** Takes the reckoning advisory lock on its own connection until `release()` (research.md R3). */
export async function holdAdvisoryLock(pool: Pool): Promise<{ release(): Promise<void> }> {
  const client = await pool.connect();
  try {
    const res = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock($1::int) as locked',
      [RECKONING_LOCK_KEY],
    );
    if (!res.rows[0]?.locked) throw new Error('advisory lock already held');
  } catch (err) {
    client.release();
    throw err;
  }
  return {
    async release() {
      await client.query('select pg_advisory_unlock($1::int)', [RECKONING_LOCK_KEY]);
      client.release();
    },
  };
}

/** A throwaway pg client for tests that need their own session (e.g. `pg_advisory_lock`). */
export async function standaloneClient(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}
