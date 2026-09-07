import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, inject, it } from 'vitest';
import * as schema from '../../src/db/schema/index.js';
import { createTestDatabase, describeWithDb, type TestDatabase } from '../helpers/db.js';

/** Every table of specs/001-repo-foundations/data-model.md §4.2–4.6. */
const EXPECTED_TABLES = [
  'factions',
  'users',
  'refresh_tokens',
  'devices',
  'walk_sessions',
  'location_samples',
  'walk_hex_meters',
  'hex_week_contribution',
  'hex_faction_strength',
  'hex_state',
  'hex_ownership_events',
  'hex_parent_state',
  'reckonings',
  'species',
  'species_region',
  'species_season',
  'captures',
  'capture_candidates',
  'user_species',
  'points_ledger',
  'streaks',
  'leaderboard_snapshots',
  'faction_stats_weekly',
  'anti_cheat_flags',
  // feature 002
  'account_exports',
  // feature 004
  'hex_reckoning_history',
  'reckoning_consistency',
];

const EXPECTED_ENUMS = [
  'kingdom',
  'capture_status',
  'ledger_kind',
  'user_role',
  'walk_status',
  'candidate_source',
  'reckoning_status',
  // feature 002
  'export_status',
];

// Kaunas town hall area, res 9 and its parents (H3 indexes as bigint).
const CELL = {
  r9: BigInt('0x891f1d4a2c3ffff'),
  r8: BigInt('0x881f1d4a2dfffff'),
  r7: BigInt('0x871f1d4a2ffffff'),
  r6: BigInt('0x861f1d4afffffff'),
  r5: BigInt('0x851f1d4bfffffff'),
};
const POLYGON_WKT =
  'POLYGON((23.884 54.895,23.888 54.895,23.888 54.898,23.884 54.898,23.884 54.895))';

describeWithDb('schema migration (data-model.md §4)', () => {
  const adminUrl = inject('adminDatabaseUrl');
  let tdb: TestDatabase;

  beforeAll(async () => {
    if (!adminUrl) throw new Error('adminDatabaseUrl was not provided by global setup');
    tdb = await createTestDatabase(adminUrl);
  });
  afterAll(async () => {
    await tdb?.close();
  });

  it('creates every table', async () => {
    const { rows } = await tdb.pool.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const names = rows.map((row) => row.table_name);
    expect(names).toEqual(expect.arrayContaining(EXPECTED_TABLES));
    for (const table of EXPECTED_TABLES) expect(names, `missing table ${table}`).toContain(table);
  });

  it('creates the seven 001 enums plus export_status', async () => {
    const { rows } = await tdb.pool.query<{ typname: string }>(
      `select typname from pg_type where typtype = 'e' order by typname`,
    );
    expect(rows.map((row) => row.typname)).toEqual(expect.arrayContaining(EXPECTED_ENUMS));
    const values = await tdb.pool.query<{ enumlabel: string }>(
      `select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
       where t.typname = 'export_status' order by e.enumsortorder`,
    );
    expect(values.rows.map((row) => row.enumlabel)).toEqual(['pending', 'ready', 'failed']);
  });

  it('migration 0003 adds account_exports and the two partial/plain indexes', async () => {
    const columns = await tdb.pool.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns
       where table_name = 'account_exports' order by ordinal_position`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'id',
      'user_id',
      'status',
      'object_key',
      'requested_at',
      'completed_at',
      'expires_at',
      'error',
    ]);
    const fk = await tdb.pool.query<{ delete_rule: string }>(
      `select rc.delete_rule from information_schema.referential_constraints rc
       join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name
       where tc.table_name = 'account_exports'`,
    );
    expect(fk.rows).toEqual([{ delete_rule: 'CASCADE' }]);

    const indexes = await tdb.pool.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes
       where indexname in ('account_exports_user_requested_idx', 'users_faction_active_idx', 'refresh_tokens_expires_idx')
       order by indexname`,
    );
    const byName = Object.fromEntries(indexes.rows.map((row) => [row.indexname, row.indexdef]));
    expect(Object.keys(byName)).toEqual([
      'account_exports_user_requested_idx',
      'refresh_tokens_expires_idx',
      'users_faction_active_idx',
    ]);
    expect(byName.users_faction_active_idx).toMatch(
      /\(faction_id, last_seen_at\) WHERE \(deleted_at IS NULL\)/,
    );
    expect(byName.refresh_tokens_expires_idx).toMatch(/\(expires_at\)/);
    console.info('feature 002 schema: account_exports + users_faction_active_idx present');
  });

  it('migration 0004 adds the walk finish columns, capped_meters and the autofinish index', async () => {
    const columns = await tdb.pool.query<{
      column_name: string;
      data_type: string;
      column_default: string | null;
      is_nullable: string;
    }>(
      `select column_name, data_type, column_default, is_nullable from information_schema.columns
       where table_name = 'walk_sessions' and column_name in ('finish_reason', 'device_info', 'xp_awarded', 'scored')
       order by column_name`,
    );
    expect(columns.rows).toEqual([
      { column_name: 'device_info', data_type: 'jsonb', column_default: null, is_nullable: 'YES' },
      { column_name: 'finish_reason', data_type: 'text', column_default: null, is_nullable: 'YES' },
      { column_name: 'scored', data_type: 'boolean', column_default: 'false', is_nullable: 'NO' },
      { column_name: 'xp_awarded', data_type: 'integer', column_default: '0', is_nullable: 'NO' },
    ]);
    const capped = await tdb.pool.query<{ data_type: string; column_default: string | null }>(
      `select data_type, column_default from information_schema.columns
       where table_name = 'walk_hex_meters' and column_name = 'capped_meters'`,
    );
    expect(capped.rows).toEqual([{ data_type: 'real', column_default: '0' }]);
    const index = await tdb.pool.query<{ indexdef: string }>(
      `select indexdef from pg_indexes where indexname = 'walk_sessions_active_started_idx'`,
    );
    expect(index.rows[0]?.indexdef).toMatch(
      /\(started_at\) WHERE \(status = 'active'::walk_status\)/,
    );
    console.info(
      'feature 003 schema: walk_sessions finish columns + walk_sessions_active_started_idx present',
    );
  });

  it('migration 0005 adds the reckoning resume state, history, consistency and the flip-XP index', async () => {
    const columns = await tdb.pool.query<{
      column_name: string;
      data_type: string;
      column_default: string | null;
      is_nullable: string;
    }>(
      `select column_name, data_type, column_default, is_nullable from information_schema.columns
       where table_name = 'reckonings' order by ordinal_position`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'week_id',
      'started_at',
      'finished_at',
      'hexes_processed',
      'flips',
      'status',
      'stage',
      'cursor_h3_r9',
      'batches',
      'parent_flips',
      'walks_autofinished',
      'push_queued',
      'error',
      'attempt',
    ]);
    expect(columns.rows.find((row) => row.column_name === 'stage')).toMatchObject({
      data_type: 'text',
      column_default: "'walks'::text",
      is_nullable: 'NO',
    });
    expect(columns.rows.find((row) => row.column_name === 'attempt')).toMatchObject({
      column_default: '1',
      is_nullable: 'NO',
    });
    expect(columns.rows.find((row) => row.column_name === 'cursor_h3_r9')).toMatchObject({
      data_type: 'bigint',
      is_nullable: 'YES',
    });

    const history = await tdb.pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'hex_reckoning_history' order by ordinal_position`,
    );
    expect(history.rows.map((row) => row.column_name)).toEqual([
      'h3_r9',
      'week_id',
      'owner_faction_id',
      'flipped',
      'from_faction',
      'to_faction',
      'captain_user_id',
      'captain_before_user_id',
      'strengths',
      'had_contributions',
      'reckoned_at',
    ]);
    const captainFks = await tdb.pool.query<{ column_name: string; delete_rule: string }>(
      `select kcu.column_name, rc.delete_rule
       from information_schema.referential_constraints rc
       join information_schema.table_constraints tc on tc.constraint_name = rc.constraint_name
       join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
       where tc.table_name = 'hex_reckoning_history' and kcu.column_name like 'captain%'
       order by kcu.column_name`,
    );
    expect(captainFks.rows).toEqual([
      { column_name: 'captain_before_user_id', delete_rule: 'SET NULL' },
      { column_name: 'captain_user_id', delete_rule: 'SET NULL' },
    ]);

    const nullable = await tdb.pool.query<{ is_nullable: string }>(
      `select is_nullable from information_schema.columns
       where table_name = 'leaderboard_snapshots' and column_name = 'user_id'`,
    );
    expect(nullable.rows).toEqual([{ is_nullable: 'YES' }]);

    const indexes = await tdb.pool.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes where indexname in (
         'points_ledger_hex_flip_unique', 'hex_reckoning_history_captain_before_idx',
         'hex_reckoning_history_week_idx', 'hex_state_last_reckoned_idx')
       order by indexname`,
    );
    const byName = Object.fromEntries(indexes.rows.map((row) => [row.indexname, row.indexdef]));
    expect(Object.keys(byName)).toEqual([
      'hex_reckoning_history_captain_before_idx',
      'hex_reckoning_history_week_idx',
      'hex_state_last_reckoned_idx',
      'points_ledger_hex_flip_unique',
    ]);
    expect(byName.points_ledger_hex_flip_unique).toMatch(/^CREATE UNIQUE INDEX/);
    expect(byName.points_ledger_hex_flip_unique).toMatch(
      /\(user_id, ref_id\) WHERE \(kind = 'hex_flip'::ledger_kind\)/,
    );
    expect(byName.hex_reckoning_history_captain_before_idx).toMatch(
      /\(week_id, captain_before_user_id\) WHERE flipped/,
    );
    const consistency = await tdb.pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'reckoning_consistency' order by ordinal_position`,
    );
    expect(consistency.rows.map((row) => row.column_name)).toEqual([
      'id',
      'ran_at',
      'parents_checked',
      'drifted',
      'repaired',
      'sample',
    ]);
    console.info('feature 004 schema: reckonings resume columns + hex_reckoning_history present');
  });

  it('partitions location_samples by range on ts with a default and monthly partitions', async () => {
    const strategy = await tdb.pool.query<{ partstrat: string; partkey: string }>(
      `select pt.partstrat, pg_get_partkeydef(pt.partrelid) as partkey
       from pg_partitioned_table pt join pg_class c on c.oid = pt.partrelid
       where c.relname = 'location_samples'`,
    );
    expect(strategy.rows).toEqual([{ partstrat: 'r', partkey: 'RANGE (ts)' }]);

    const partitions = await tdb.pool.query<{ relname: string }>(
      `select c.relname from pg_inherits i join pg_class c on c.oid = i.inhrelid
       join pg_class p on p.oid = i.inhparent where p.relname = 'location_samples' order by 1`,
    );
    const names = partitions.rows.map((row) => row.relname);
    expect(names).toContain('location_samples_default');
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    expect(names).toContain(`location_samples_y${y}m${m}`);
    expect(names.filter((name) => /^location_samples_y\d{4}m\d{2}$/.test(name)).length).toBe(2);
  });

  it('seeds the three factions', async () => {
    const rows = await tdb.db.select().from(schema.factions).orderBy(schema.factions.sort);
    expect(rows.map((row) => [row.id, row.slug, row.emoji])).toEqual([
      [1, 'owls', '🦉'],
      [2, 'foxes', '🦊'],
      [3, 'deer', '🦌'],
    ]);
  });

  it('has PostGIS and reports whether h3-pg is present (optional)', async () => {
    const postgis = await tdb.pool.query<{ postgis_version: string }>('select postgis_version()');
    expect(postgis.rows[0]?.postgis_version).toMatch(/^3\./);

    const h3 = await tdb.pool.query<{ extname: string }>(
      `select extname from pg_extension where extname in ('h3', 'h3_postgis') order by 1`,
    );
    const present = h3.rows.map((row) => row.extname);
    console.info(`h3-pg extensions present: ${present.length ? present.join(', ') : 'none'}`);
    if (present.includes('h3')) {
      const res = await tdb.pool.query<{ r: number }>(
        `select h3_get_resolution(h3_lat_lng_to_cell(point(23.9, 54.9), 9)) as r`,
      );
      expect(res.rows[0]?.r).toBe(9);
    }
  });

  it('inserts a faction, a user and a hex_state row that round-trip through Drizzle', async () => {
    await tdb.db.insert(schema.factions).values({
      id: 9,
      slug: 'test-faction',
      name: 'Test',
      emoji: '🧪',
      colorLight: '#000000',
      colorDark: '#ffffff',
      sort: 9,
    });

    const [user] = await tdb.db
      .insert(schema.users)
      .values({ appleSub: 'apple-sub-test', displayName: 'Tester', factionId: 9 })
      .returning({ id: schema.users.id, role: schema.users.role, xp: schema.users.xp });
    expect(user).toMatchObject({ role: 'player', xp: 0 });
    expect(user?.id).toMatch(/^[0-9a-f-]{36}$/);

    await tdb.db.insert(schema.hexState).values({
      h3R9: CELL.r9,
      h3R8: CELL.r8,
      h3R7: CELL.r7,
      h3R6: CELL.r6,
      h3R5: CELL.r5,
      geom: POLYGON_WKT,
      ownerFactionId: 9,
      ownerSinceWeek: '2026-W36',
      captainUserId: user?.id,
    });

    const [row] = await tdb.db
      .select({
        h3R9: schema.hexState.h3R9,
        h3R8: schema.hexState.h3R8,
        h3R7: schema.hexState.h3R7,
        h3R6: schema.hexState.h3R6,
        h3R5: schema.hexState.h3R5,
        ownerFactionId: schema.hexState.ownerFactionId,
        ownerSinceWeek: schema.hexState.ownerSinceWeek,
        captainUserId: schema.hexState.captainUserId,
        version: schema.hexState.version,
        srid: sql<number>`ST_SRID(${schema.hexState.geom})`,
        sameGeom: sql<boolean>`ST_Equals(${schema.hexState.geom}, ST_GeomFromText(${POLYGON_WKT}, 4326))`,
        wkt: sql<string>`ST_AsText(${schema.hexState.geom})`,
      })
      .from(schema.hexState)
      .where(eq(schema.hexState.h3R9, CELL.r9));

    expect(row).toMatchObject({
      h3R9: CELL.r9,
      h3R8: CELL.r8,
      h3R7: CELL.r7,
      h3R6: CELL.r6,
      h3R5: CELL.r5,
      ownerFactionId: 9,
      ownerSinceWeek: '2026-W36',
      captainUserId: user?.id,
      version: 0,
      srid: 4326,
      sameGeom: true,
    });
    expect(row?.wkt).toMatch(/^POLYGON\(\(/);
  });

  it('routes a location sample into the partition of its month', async () => {
    const [user] = await tdb.db
      .insert(schema.users)
      .values({ appleSub: 'apple-sub-walker', displayName: 'Walker', factionId: 1 })
      .returning({ id: schema.users.id });
    const ts = new Date();
    const [walk] = await tdb.db
      .insert(schema.walkSessions)
      .values({ userId: user!.id, clientWalkId: crypto.randomUUID(), factionId: 1, startedAt: ts })
      .returning({
        id: schema.walkSessions.id,
        status: schema.walkSessions.status,
        flags: schema.walkSessions.flags,
      });
    expect(walk).toMatchObject({ status: 'active', flags: [] });

    await tdb.db.insert(schema.locationSamples).values({
      walkId: walk!.id,
      seq: 0,
      ts,
      lat: 54.8969,
      lon: 23.8862,
      hAcc: 8,
      speed: 1.4,
    });

    const { rows } = await tdb.pool.query<{ partition: string }>(
      `select tableoid::regclass::text as partition from location_samples where walk_id = $1`,
      [walk!.id],
    );
    const y = ts.getUTCFullYear();
    const m = String(ts.getUTCMonth() + 1).padStart(2, '0');
    expect(rows).toEqual([{ partition: `location_samples_y${y}m${m}` }]);

    // ON DELETE CASCADE reaches through the partitioned table.
    await tdb.db.delete(schema.walkSessions).where(eq(schema.walkSessions.id, walk!.id));
    const left = await tdb.pool.query(`select 1 from location_samples where walk_id = $1`, [
      walk!.id,
    ]);
    expect(left.rowCount).toBe(0);
  });
});
