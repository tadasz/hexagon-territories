import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  hexParentState,
  hexState,
  hexWeekContribution,
  pointsLedger,
} from '../../src/db/schema/index.js';
import { cellPolygonWkt, cellToBigInt, parentsOf } from '../../src/lib/h3.js';
import {
  snapshotFactionStats,
  snapshotLeaderboards,
} from '../../src/modules/territory/reckoning/rollup.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';
import { seedUser } from '../helpers/reckoning.js';

const W = '2026-W36';
const NOW = new Date('2026-09-07T00:00:10.000Z');
const CELLS = ['891f40da99bffff', '891f40da993ffff', '891f40da997ffff'];

describeWithDb('rollup stage: leaderboards and faction stats (research.md R14, FR-007)', () => {
  let h: IntegrationHarness;
  const userIds: string[] = [];

  beforeAll(async () => {
    h = await createIntegrationHarness();
    for (const [i, name] of ['alpha', 'bravo', 'charlie', 'delta'].entries()) {
      userIds.push(await seedUser(h.tdb, name, (i % 3) + 1));
    }
    const [alpha, bravo, charlie, delta] = userIds as [string, string, string, string];
    // faction 1: alpha 2000 + 500 (two cells) = 2500, delta 2500 (one cell) — tie broken by user id
    // faction 2: bravo 1200; faction 3: charlie 300 + a bonus-only row (0 metres) for delta
    const rows = [
      { cell: CELLS[0]!, faction: 1, user: alpha, meters: 2600, capped: 2000, bonus: 0 },
      { cell: CELLS[1]!, faction: 1, user: alpha, meters: 500, capped: 500, bonus: 0 },
      { cell: CELLS[2]!, faction: 1, user: delta, meters: 2500, capped: 2500, bonus: 0 },
      { cell: CELLS[0]!, faction: 2, user: bravo, meters: 1200, capped: 1200, bonus: 0 },
      { cell: CELLS[1]!, faction: 3, user: charlie, meters: 300, capped: 300, bonus: 300 },
      { cell: CELLS[2]!, faction: 3, user: delta, meters: 0, capped: 0, bonus: 200 },
    ];
    await h.tdb.db.insert(hexWeekContribution).values(
      rows.map((r) => ({
        h3R9: cellToBigInt(r.cell),
        weekId: W,
        factionId: r.faction,
        userId: r.user,
        meters: r.meters,
        cappedMeters: r.capped,
        captureBonusM: r.bonus,
        walks: r.meters > 0 ? 1 : 0,
      })),
    );
    await h.tdb.db.insert(pointsLedger).values([
      { userId: alpha, factionId: 1, kind: 'walk_distance', points: 26, weekId: W },
      { userId: alpha, factionId: 1, kind: 'hex_flip', points: 15, weekId: W, refId: '1' },
      { userId: bravo, factionId: 2, kind: 'walk_distance', points: 12, weekId: '2026-W35' },
    ]);
    // ownership: faction 1 owns two cells, faction 2 one; one res-7 parent owned by faction 1
    await h.tdb.db.insert(hexState).values(
      CELLS.map((cell, i) => {
        const p = parentsOf(cell);
        return {
          h3R9: cellToBigInt(cell),
          h3R8: cellToBigInt(p.r8),
          h3R7: cellToBigInt(p.r7),
          h3R6: cellToBigInt(p.r6),
          h3R5: cellToBigInt(p.r5),
          geom: cellPolygonWkt(cell),
          ownerFactionId: i < 2 ? 1 : 2,
          ownerSinceWeek: W,
        };
      }),
    );
    const r7 = parentsOf(CELLS[0]!).r7;
    await h.tdb.db.insert(hexParentState).values({
      h3: cellToBigInt(r7),
      res: 7,
      geom: cellPolygonWkt(r7),
      ownerFactionId: 1,
      childOwnerCounts: { '1': 2, '2': 1 },
      claimedChildren: 3,
    });
  });
  afterAll(async () => {
    await h?.close();
  });

  it('ranks the global and per-faction boards by counted metres with the week points', async () => {
    const [alpha, bravo, charlie, delta] = userIds as [string, string, string, string];
    const written = await h.tdb.db.transaction((tx) => snapshotLeaderboards(tx, W, NOW));
    const { rows } = await h.tdb.pool.query<{
      scope: string;
      scope_id: string;
      rank: number;
      user_id: string;
      meters: number;
      points: number;
    }>(
      'select scope, scope_id, rank, user_id, meters, points from leaderboard_snapshots where week_id = $1 order by scope, scope_id, rank',
      [W],
    );
    expect(written).toBe(rows.length);
    const global = rows.filter((r) => r.scope === 'global');
    // alpha 2500 and delta 2500 tie → user id ascending
    const tie = [alpha, delta].sort();
    expect(global.map((r) => [r.rank, r.user_id, r.meters, r.points])).toEqual([
      [1, tie[0], 2500, tie[0] === alpha ? 41 : 0],
      [2, tie[1], 2500, tie[1] === alpha ? 41 : 0],
      [3, bravo, 1200, 0],
      [4, charlie, 300, 0],
    ]);
    const faction1 = rows.filter((r) => r.scope === 'faction' && r.scope_id === '1');
    expect(faction1.map((r) => [r.rank, r.user_id])).toEqual([
      [1, tie[0]],
      [2, tie[1]],
    ]);
    expect(
      rows.filter((r) => r.scope === 'faction' && r.scope_id === '2').map((r) => r.user_id),
    ).toEqual([bravo]);
    // delta's bonus-only row for faction 3 carries no walking metres: not on the faction-3 board
    expect(
      rows.filter((r) => r.scope === 'faction' && r.scope_id === '3').map((r) => r.user_id),
    ).toEqual([charlie]);
    expect(rows.every((r) => r.scope !== 'hex_r7')).toBe(true);
  });

  it('snapshots per-faction stats: hexes r9/r7, counted metres, active walkers, captures', async () => {
    const written = await h.tdb.db.transaction((tx) => snapshotFactionStats(tx, W));
    expect(written).toBe(3);
    const { rows } = await h.tdb.pool.query<{
      faction_id: number;
      hexes_owned_r9: number;
      hexes_owned_r7: number;
      meters: number;
      active_users: number;
      captures: number;
    }>(
      'select faction_id, hexes_owned_r9, hexes_owned_r7, meters, active_users, captures from faction_stats_weekly where week_id = $1 order by faction_id',
      [W],
    );
    expect(rows).toEqual([
      {
        faction_id: 1,
        hexes_owned_r9: 2,
        hexes_owned_r7: 1,
        meters: 5000,
        active_users: 2,
        captures: 0,
      },
      {
        faction_id: 2,
        hexes_owned_r9: 1,
        hexes_owned_r7: 0,
        meters: 1200,
        active_users: 1,
        captures: 0,
      },
      {
        faction_id: 3,
        hexes_owned_r9: 0,
        hexes_owned_r7: 0,
        meters: 300,
        active_users: 2,
        captures: 0,
      },
    ]);
  });

  it('is idempotent: a rerun replaces the rows instead of duplicating them', async () => {
    const before = await h.tdb.pool.query(
      'select * from leaderboard_snapshots where week_id = $1 order by scope, scope_id, rank',
      [W],
    );
    const stats = await h.tdb.pool.query(
      'select * from faction_stats_weekly where week_id = $1 order by faction_id',
      [W],
    );
    await h.tdb.db.transaction(async (tx) => {
      await snapshotLeaderboards(tx, W, NOW);
      await snapshotFactionStats(tx, W);
    });
    const after = await h.tdb.pool.query(
      'select * from leaderboard_snapshots where week_id = $1 order by scope, scope_id, rank',
      [W],
    );
    const statsAfter = await h.tdb.pool.query(
      'select * from faction_stats_weekly where week_id = $1 order by faction_id',
      [W],
    );
    expect(after.rows).toEqual(before.rows);
    expect(statsAfter.rows).toEqual(stats.rows);
    // another week's rows are untouched
    await h.tdb.db.transaction((tx) => snapshotLeaderboards(tx, '2026-W35', NOW));
    const other = await h.tdb.pool.query(
      'select count(*)::text as n from leaderboard_snapshots where week_id = $1',
      [W],
    );
    expect(other.rows[0]).toEqual({ n: String(before.rows.length) });
  });
});
