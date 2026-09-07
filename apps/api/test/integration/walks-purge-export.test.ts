import { readFileSync } from 'node:fs';
import { parseTrack, simulate, SAMPLE_TRACKS } from '@nature/walk-sim';
import { Value } from '@sinclair/typebox/value';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  antiCheatFlags,
  hexWeekContribution,
  locationSamples,
  pointsLedger,
  users,
  walkHexMeters,
  walkSessions,
} from '../../src/db/schema/index.js';
import { runAccountPurge } from '../../src/jobs/account-purge.js';
import { ExportBundleSchema, buildExportBundle } from '../../src/modules/me/export-sections.js';
import { PURGE_STEPS, purgeCoveredTables } from '../../src/modules/me/purge.js';
import type { WalkSummary } from '../../src/modules/walks/schemas.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';
import { userWithFaction, walkThrough, type WalkUser } from '../helpers/walks.js';

interface ForeignKey {
  table_name: string;
  delete_rule: string;
}

describeWithDb('walks purge step and export sections (FR-016, Constitution IV)', () => {
  let h: IntegrationHarness;
  let user: WalkUser;
  let walkIds: string[];

  beforeAll(async () => {
    h = await createIntegrationHarness();
    user = await userWithFaction(h, 'purge-export-walker', 2);
    walkIds = [];
    for (const path of [SAMPLE_TRACKS.laisvesAlejaStraight, SAMPLE_TRACKS.carA1]) {
      const sim = simulate(parseTrack(readFileSync(path, 'utf8'), 'gpx'));
      walkIds.push((await walkThrough(h, user, sim.samples, sim.pedometerSteps)).walkId);
    }
  });
  afterAll(async () => {
    await h?.close();
  });

  async function countRows(userId: string) {
    const walks = await h.tdb.db
      .select({ id: walkSessions.id })
      .from(walkSessions)
      .where(eq(walkSessions.userId, userId));
    const ids = walks.map((w) => w.id);
    const count = async (table: string, column: string, values: string[]) => {
      if (values.length === 0) return 0;
      const { rows } = await h.tdb.pool.query<{ n: string }>(
        `select count(*)::text as n from ${table} where ${column} = any($1::uuid[])`,
        [values],
      );
      return Number(rows[0]?.n ?? 0);
    };
    return {
      walk_sessions: ids.length,
      location_samples: await count('location_samples', 'walk_id', ids),
      walk_hex_meters: await count('walk_hex_meters', 'walk_id', ids),
      hex_week_contribution: await count('hex_week_contribution', 'user_id', [userId]),
      points_ledger: await count('points_ledger', 'user_id', [userId]),
      anti_cheat_flags: await count('anti_cheat_flags', 'user_id', [userId]),
    };
  }

  it('covers every table with a users foreign key that walks write (002 FK-coverage rule)', async () => {
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
    for (const table of [
      'walk_sessions',
      'hex_week_contribution',
      'points_ledger',
      'anti_cheat_flags',
    ]) {
      expect(covered.has(table), table).toBe(true);
    }
  });

  it('exports a walks section (summaries with path and hexes) and a points section', async () => {
    const bundle = await buildExportBundle(
      { db: h.tdb.db, refreshTtlDays: 60 },
      user.userId,
      h.clock.now(),
    );
    expect(Value.Check(ExportBundleSchema, bundle)).toBe(true);
    const walks = bundle.walks as (WalkSummary & { deviceInfo: unknown })[];
    expect(walks.map((w) => w.walkId).sort()).toEqual([...walkIds].sort());
    const finished = walks.find((w) => w.walkId === walkIds[0])!;
    expect(finished.status).toBe('finished');
    expect(finished.path?.type).toBe('LineString');
    expect(finished.hexes.length).toBeGreaterThanOrEqual(5);
    expect(finished.hexes[0]).toMatchObject({
      meters: expect.any(Number) as number,
      cappedMeters: expect.any(Number) as number,
      weekStanding: { leader: 2 },
    });
    expect(finished.deviceInfo).toBeNull();
    const flagged = walks.find((w) => w.walkId === walkIds[1])!;
    expect(flagged.status).toBe('flagged');
    expect(flagged.flags).toEqual(['teleport', 'speed', 'no_steps']);
    const points = bundle.points as {
      kind: string;
      points: number;
      refId: string | null;
      h3: string | null;
    }[];
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ kind: 'walk_distance', refId: walkIds[0], h3: null });
    expect(points[0]!.points).toBeGreaterThan(0);
  });

  it('erases every walk row of the player with the account (and only theirs)', async () => {
    const bystander = await userWithFaction(h, 'purge-export-bystander', 3);
    const sim = simulate(
      parseTrack(readFileSync(SAMPLE_TRACKS.laisvesAlejaStraight, 'utf8'), 'gpx'),
    );
    await walkThrough(h, bystander, sim.samples, sim.pedometerSteps);

    const before = await countRows(user.userId);
    expect(before).toMatchObject({
      walk_sessions: 2,
      hex_week_contribution: expect.any(Number) as number,
      points_ledger: 1,
      anti_cheat_flags: 3,
    });
    expect(before.location_samples).toBeGreaterThan(200);
    expect(before.walk_hex_meters).toBeGreaterThan(5);
    expect(before.hex_week_contribution).toBeGreaterThanOrEqual(5);

    const del = await h.app.inject({ method: 'DELETE', url: '/v1/me', headers: user.headers });
    expect(del.statusCode).toBe(200);
    h.clock.advanceDays(31);
    const result = await runAccountPurge(
      {
        db: h.tdb.db,
        storage: h.storage,
        clock: h.clock,
        log: h.app.log,
        graceDays: h.config.account.purgeGraceDays,
      },
      { userId: user.userId, deletedAt: '' },
    );
    expect(result.purged).toBe(true);
    const walksStep = result.steps.find((s) => s.name === 'walks');
    expect(walksStep?.rows).toBe(
      2 + before.points_ledger + before.anti_cheat_flags + before.hex_week_contribution,
    );

    expect(await countRows(user.userId)).toEqual({
      walk_sessions: 0,
      location_samples: 0,
      walk_hex_meters: 0,
      hex_week_contribution: 0,
      points_ledger: 0,
      anti_cheat_flags: 0,
    });
    expect(await h.tdb.db.select().from(users).where(eq(users.id, user.userId))).toHaveLength(0);
    for (const table of [
      locationSamples,
      walkHexMeters,
      hexWeekContribution,
      pointsLedger,
      antiCheatFlags,
    ]) {
      expect(table).toBeDefined();
    }
    const other = await countRows(bystander.userId);
    expect(other.walk_sessions).toBe(1);
    expect(other.location_samples).toBeGreaterThan(200);
    expect(other.points_ledger).toBe(1);
  });
});
