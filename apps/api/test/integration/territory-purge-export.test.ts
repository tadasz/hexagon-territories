import { loadFixture, type ReckoningWeeksFixture } from '@nature/h3-fixtures';
import { Value } from '@sinclair/typebox/value';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { ExportBundleSchema, buildExportBundle } from '../../src/modules/me/export-sections.js';
import { PURGE_STEPS, purgeCoveredTables, purgeUser } from '../../src/modules/me/purge.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';
import {
  reckoningDeps,
  runFixtureWeek,
  seedFixtureWeeks,
  type SeededFixture,
} from '../helpers/reckoning.js';

const fixture: ReckoningWeeksFixture = loadFixture('reckoning-weeks');

interface ForeignKey {
  table_name: string;
  delete_rule: string;
}

interface TerritorySection {
  flips: { h3: string | null; weekId: string | null; factionId: number | null; xp: number }[];
  captainOf: string[];
  leaderboard: {
    weekId: string;
    scope: string;
    scopeId: string;
    rank: number;
    meters: number;
    points: number;
  }[];
}

describeWithDb('territory purge steps and export section (FR-017, SC-007, Constitution IV)', () => {
  let h: IntegrationHarness;
  let seeded: SeededFixture;
  let u1: string;

  beforeAll(async () => {
    h = await createIntegrationHarness();
    seeded = await seedFixtureWeeks(h.tdb, fixture);
    u1 = seeded.users.get('u1')!;
    const deps = reckoningDeps(h.tdb, h.clock);
    for (const weekId of fixture.weeks) await runFixtureWeek(deps, weekId, h.clock);
    // a stand-in for the pg-boss table (the harness uses a fake boss): two queued pushes of u1
    await h.tdb.pool.query(`
      create schema if not exists pgboss;
      create table pgboss.job (id uuid primary key default gen_random_uuid(), name text not null, state text not null, data jsonb not null);
    `);
    await h.tdb.pool.query(
      `insert into pgboss.job (name, state, data) values
        ('push.send', 'created', $1::jsonb), ('push.send', 'created', $2::jsonb),
        ('push.send', 'completed', $3::jsonb), ('push.send', 'created', $4::jsonb)`,
      [
        JSON.stringify({
          kind: 'reckoning_result',
          userId: u1,
          weekId: '2026-W36',
          flips: 1,
          lost: 0,
        }),
        JSON.stringify({
          kind: 'reckoning_result',
          userId: u1,
          weekId: '2026-W37',
          flips: 3,
          lost: 0,
        }),
        JSON.stringify({
          kind: 'reckoning_result',
          userId: u1,
          weekId: '2026-W35',
          flips: 7,
          lost: 0,
        }),
        JSON.stringify({
          kind: 'reckoning_result',
          userId: seeded.users.get('u2'),
          weekId: '2026-W37',
          flips: 0,
          lost: 1,
        }),
      ],
    );
  });
  afterAll(async () => {
    await h?.close();
  });

  it('covers every table with a users foreign key (002 FK-coverage rule) including the 004 ones', async () => {
    const { rows } = await h.tdb.pool.query<ForeignKey>(`
      select tc.table_name, rc.delete_rule
      from information_schema.table_constraints tc
      join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
      where tc.constraint_type = 'FOREIGN KEY' and ccu.table_name = 'users' and ccu.column_name = 'id'
    `);
    const covered = purgeCoveredTables(PURGE_STEPS);
    const uncovered = rows
      .filter(
        (fk) =>
          fk.delete_rule !== 'CASCADE' &&
          fk.delete_rule !== 'SET NULL' &&
          !covered.has(fk.table_name),
      )
      .map((fk) => fk.table_name);
    expect(uncovered).toEqual([]);
    expect(rows.some((fk) => fk.table_name === 'hex_reckoning_history')).toBe(true);
    expect(covered.has('leaderboard_snapshots')).toBe(true);
  });

  it('exports a territory section with flips, captaincies and leaderboard placements', async () => {
    const bundle = await buildExportBundle({ db: h.tdb.db, refreshTtlDays: 60 }, u1, h.clock.now());
    expect(Value.Check(ExportBundleSchema, bundle)).toBe(true);
    const territory = bundle.territory as TerritorySection;
    const { rows: flips } = await h.tdb.pool.query<{ n: string }>(
      "select count(*)::text as n from points_ledger where user_id = $1 and kind = 'hex_flip'",
      [u1],
    );
    expect(territory.flips).toHaveLength(Number(flips[0]!.n));
    expect(territory.flips[0]).toMatchObject({ weekId: fixture.weeks[0], xp: 15, factionId: 1 });
    expect(territory.flips[0]!.h3).toMatch(/^[0-9a-f]{15}$/);
    const { rows: captain } = await h.tdb.pool.query<{ h3_r9: string }>(
      'select h3_r9 from hex_state where captain_user_id = $1 order by h3_r9',
      [u1],
    );
    expect(territory.captainOf).toHaveLength(captain.length);
    expect(captain.length).toBeGreaterThan(0);
    expect(territory.leaderboard.length).toBeGreaterThanOrEqual(fixture.weeks.length);
    expect(territory.leaderboard[0]).toMatchObject({
      weekId: fixture.weeks[0],
      scope: 'faction',
      scopeId: '1',
      rank: 1,
    });
    expect(territory.leaderboard.some((row) => row.scope === 'global')).toBe(true);
  });

  it('anonymises leaderboard rows, clears captaincies and history, drops queued pushes and keeps events', async () => {
    const boards = await h.tdb.pool.query<{ n: string }>(
      'select count(*)::text as n from leaderboard_snapshots where user_id = $1',
      [u1],
    );
    expect(Number(boards.rows[0]!.n)).toBeGreaterThan(0);
    const totalBoards = await h.tdb.pool.query<{ n: string }>(
      'select count(*)::text as n from leaderboard_snapshots',
    );
    const events = await h.tdb.pool.query(
      'select id, h3_r9, week_id, from_faction, to_faction from hex_ownership_events order by id',
    );
    const historyRows = await h.tdb.pool.query<{ n: string }>(
      'select count(*)::text as n from hex_reckoning_history',
    );
    const captainHistory = await h.tdb.pool.query<{ n: string }>(
      'select count(*)::text as n from hex_reckoning_history where captain_user_id = $1 or captain_before_user_id = $1',
      [u1],
    );
    expect(Number(captainHistory.rows[0]!.n)).toBeGreaterThan(0);

    const outcome = await purgeUser(h.tdb.db, h.storage, u1);
    const byName = Object.fromEntries(outcome.steps.map((s) => [s.name, s.rows]));
    expect(byName.leaderboard_snapshots).toBe(Number(boards.rows[0]!.n));
    expect(byName.territory).toBeGreaterThanOrEqual(Number(captainHistory.rows[0]!.n) + 2);
    expect(byName.users).toBe(1);

    const after = await h.tdb.pool.query<{ n: string }>(
      'select count(*)::text as n from leaderboard_snapshots',
    );
    expect(after.rows[0]).toEqual(totalBoards.rows[0]);
    const mine = await h.tdb.pool.query('select 1 from leaderboard_snapshots where user_id = $1', [
      u1,
    ]);
    expect(mine.rows).toEqual([]);
    const anonymous = await h.tdb.pool.query<{ rank: number; scope: string }>(
      'select rank, scope from leaderboard_snapshots where user_id is null order by week_id, scope, scope_id, rank',
    );
    expect(anonymous.rows.length).toBe(Number(boards.rows[0]!.n));
    const captain = await h.tdb.pool.query('select 1 from hex_state where captain_user_id = $1', [
      u1,
    ]);
    expect(captain.rows).toEqual([]);
    const history = await h.tdb.pool.query(
      'select 1 from hex_reckoning_history where captain_user_id = $1 or captain_before_user_id = $1',
      [u1],
    );
    expect(history.rows).toEqual([]);
    const historyAfter = await h.tdb.pool.query<{ n: string }>(
      'select count(*)::text as n from hex_reckoning_history',
    );
    expect(historyAfter.rows[0]).toEqual(historyRows.rows[0]);
    const pushes = await h.tdb.pool.query<{ state: string; user_id: string }>(
      "select state, data->>'userId' as user_id from pgboss.job where name = 'push.send' order by state",
    );
    expect(pushes.rows).toEqual([
      { state: 'completed', user_id: u1 },
      { state: 'created', user_id: seeded.users.get('u2') },
    ]);
    const eventsAfter = await h.tdb.pool.query(
      'select id, h3_r9, week_id, from_faction, to_faction from hex_ownership_events order by id',
    );
    expect(eventsAfter.rows).toEqual(events.rows);
    const ledger = await h.tdb.pool.query('select 1 from points_ledger where user_id = $1', [u1]);
    expect(ledger.rows).toEqual([]);
    const user = await h.tdb.pool.query('select 1 from users where id = $1', [u1]);
    expect(user.rows).toEqual([]);
    // no row of any 004 table references the player any more (SC-007)
    for (const [table, column] of [
      ['hex_reckoning_history', 'captain_user_id'],
      ['hex_reckoning_history', 'captain_before_user_id'],
      ['hex_state', 'captain_user_id'],
      ['leaderboard_snapshots', 'user_id'],
      ['points_ledger', 'user_id'],
    ]) {
      const left = await h.tdb.pool.query(`select 1 from ${table} where ${column} = $1`, [u1]);
      expect(left.rows, `${table}.${column}`).toEqual([]);
    }
  });
});
