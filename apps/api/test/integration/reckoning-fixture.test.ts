import { loadFixture, type ReckoningWeeksFixture } from '@nature/h3-fixtures';
import { deriveParentOwner, RULES } from '@nature/territory-rules';
import { cellToParent } from 'h3-js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { bigIntToCell, cellToBigInt } from '../../src/lib/h3.js';
import type { ReckoningRunResult } from '../../src/modules/territory/reckoning/run.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';
import {
  reckoningDeps,
  runFixtureWeek,
  seedFixtureWeeks,
  type SeededFixture,
} from '../helpers/reckoning.js';

const fixture: ReckoningWeeksFixture = loadFixture('reckoning-weeks');

interface StrengthRow {
  faction_id: number;
  strength: number;
  last_reckoned_week: string;
}
interface StateRow {
  owner_faction_id: number | null;
  owner_since_week: string | null;
  captain_user_id: string | null;
  last_reckoned_week: string;
  last_activity_week: string | null;
  version: number;
}
interface EventRow {
  week_id: string;
  from_faction: number | null;
  to_faction: number | null;
  cause: string;
}
interface HistoryRow {
  week_id: string;
  owner_faction_id: number | null;
  flipped: boolean;
  from_faction: number | null;
  to_faction: number | null;
  captain_user_id: string | null;
  strengths: { factionId: number; strength: number }[];
  had_contributions: boolean;
}

describeWithDb(
  'reckoning.weekly replays reckoning-weeks.json (SC-001, FR-003/FR-004/FR-006/FR-007)',
  () => {
    let h: IntegrationHarness;
    let seeded: SeededFixture;
    const results: ReckoningRunResult[] = [];

    beforeAll(async () => {
      h = await createIntegrationHarness();
      seeded = await seedFixtureWeeks(h.tdb, fixture);
      const deps = reckoningDeps(h.tdb, h.clock, { batchSize: 4 });
      for (const weekId of fixture.weeks) results.push(await runFixtureWeek(deps, weekId, h.clock));
    });
    afterAll(async () => {
      await h?.close();
    });

    const cellId = (cell: string) => cellToBigInt(cell).toString();

    it('reckons the three weeks in order with the expected counts', () => {
      expect(results.map((r) => r.weekId)).toEqual(fixture.weeks);
      for (const [i, result] of results.entries()) {
        expect(result.status).toBe('done');
        expect(result.dryRun).toBe(false);
        expect(result.resumed).toBe(false);
        expect(result.hexesProcessed).toBe(fixture.cells.length);
        const expectedFlips = fixture.cells.filter((c) => c.weeks[i]!.expected.flipped).length;
        expect(result.flips, result.weekId).toBe(expectedFlips);
        expect(result.pushQueued).toBe(0); // boss null in these deps
        expect(result.flipsPreview).toEqual([]);
      }
    });

    it('stores the expected strengths (±0.01), owners, owner-since weeks and captains after the last week', async () => {
      for (const cell of fixture.cells) {
        const last = cell.weeks[cell.weeks.length - 1]!;
        const { rows: strengths } = await h.tdb.pool.query<StrengthRow>(
          'select faction_id, strength, last_reckoned_week from hex_faction_strength where h3_r9 = $1 order by faction_id',
          [cellId(cell.cell)],
        );
        expect(
          strengths.map((s) => s.faction_id),
          cell.id,
        ).toEqual(last.expected.strengths.map((s) => s.factionId));
        for (const [i, s] of strengths.entries()) {
          expect(s.strength, `${cell.id} faction ${String(s.faction_id)}`).toBeCloseTo(
            last.expected.strengths[i]!.strength,
            2,
          );
          expect(s.last_reckoned_week).toBe(last.weekId);
        }
        const { rows: states } = await h.tdb.pool.query<StateRow>(
          'select owner_faction_id, owner_since_week, captain_user_id, last_reckoned_week, last_activity_week, version from hex_state where h3_r9 = $1',
          [cellId(cell.cell)],
        );
        expect(states, cell.id).toHaveLength(1);
        const state = states[0]!;
        expect(state.owner_faction_id, cell.id).toBe(last.expected.owner);
        expect(state.captain_user_id, cell.id).toBe(
          last.expected.captain === null ? null : seeded.users.get(last.expected.captain),
        );
        expect(state.last_reckoned_week).toBe(last.weekId);
        expect(state.version).toBe(fixture.weeks.length - 1);
        // owner_since_week = the last week the cell flipped to its current owner
        let since: string | null = null;
        for (const week of cell.weeks) {
          if (week.expected.flipped) since = week.expected.owner === null ? null : week.weekId;
        }
        expect(state.owner_since_week, cell.id).toBe(since);
      }
    });

    it('records exactly the fixture events and one history row per cell and week', async () => {
      for (const cell of fixture.cells) {
        const { rows: events } = await h.tdb.pool.query<EventRow>(
          'select week_id, from_faction, to_faction, cause from hex_ownership_events where h3_r9 = $1 order by week_id',
          [cellId(cell.cell)],
        );
        const expectedEvents = cell.weeks
          .filter((w) => w.expected.event)
          .map((w) => ({
            week_id: w.weekId,
            from_faction: w.expected.event!.from,
            to_faction: w.expected.event!.to,
            cause: 'reckoning',
          }));
        expect(events, cell.id).toEqual(expectedEvents);

        const { rows: history } = await h.tdb.pool.query<HistoryRow>(
          'select week_id, owner_faction_id, flipped, from_faction, to_faction, captain_user_id, strengths, had_contributions from hex_reckoning_history where h3_r9 = $1 order by week_id',
          [cellId(cell.cell)],
        );
        expect(
          history.map((r) => r.week_id),
          cell.id,
        ).toEqual(fixture.weeks);
        for (const [i, row] of history.entries()) {
          const week = cell.weeks[i]!;
          expect(row.owner_faction_id, `${cell.id} ${week.weekId}`).toBe(week.expected.owner);
          expect(row.flipped).toBe(week.expected.flipped);
          expect(row.from_faction).toBe(week.expected.event?.from ?? null);
          expect(row.to_faction).toBe(week.expected.event?.to ?? null);
          expect(row.captain_user_id).toBe(
            week.expected.captain === null ? null : seeded.users.get(week.expected.captain),
          );
          expect(row.had_contributions).toBe(
            week.contributions.length > 0 || week.bonuses.length > 0,
          );
          expect(row.strengths.map((s) => s.factionId)).toEqual(
            week.expected.strengths.map((s) => s.factionId),
          );
          for (const [j, s] of row.strengths.entries()) {
            expect(s.strength).toBeCloseTo(week.expected.strengths[j]!.strength, 2);
          }
        }
      }
    });

    it('derives every parent of the fixture cells with deriveParentOwner over the children (FR-006)', async () => {
      const { rows: states } = await h.tdb.pool.query<{
        h3_r9: string;
        h3_r8: string;
        h3_r7: string;
        h3_r6: string;
        h3_r5: string;
        owner_faction_id: number | null;
      }>('select h3_r9, h3_r8, h3_r7, h3_r6, h3_r5, owner_faction_id from hex_state');
      expect(states).toHaveLength(fixture.cells.length);
      for (const state of states) {
        const cell = bigIntToCell(state.h3_r9);
        expect(bigIntToCell(state.h3_r8)).toBe(cellToParent(cell, 8));
        expect(bigIntToCell(state.h3_r5)).toBe(cellToParent(cell, 5));
      }
      const { rows: parents } = await h.tdb.pool.query<{
        h3: string;
        res: number;
        owner_faction_id: number | null;
        child_owner_counts: Record<string, number>;
        claimed_children: number;
      }>(
        'select h3, res, owner_faction_id, child_owner_counts, claimed_children from hex_parent_state order by res desc, h3',
      );
      expect(parents.length).toBeGreaterThan(0);
      let checked = 0;
      for (const parent of parents) {
        const column = `h3_r${String(parent.res)}` as 'h3_r8' | 'h3_r7' | 'h3_r6' | 'h3_r5';
        const children = states
          .filter((s) => s[column] === parent.h3)
          .map((s) => s.owner_faction_id);
        expect(children.length, bigIntToCell(parent.h3)).toBeGreaterThan(0);
        expect(parent.owner_faction_id, bigIntToCell(parent.h3)).toBe(deriveParentOwner(children));
        const claimed = children.filter((c) => c !== null);
        expect(parent.claimed_children).toBe(claimed.length);
        const counts: Record<string, number> = {};
        for (const c of claimed) counts[String(c)] = (counts[String(c)] ?? 0) + 1;
        expect(parent.child_owner_counts).toEqual(counts);
        checked += 1;
      }
      // every level of every cell that ever flipped is materialised (a never-claimed cell touches
      // no parent: parents are created from flip deltas, research.md R6)
      const levels = new Set(parents.map((p) => p.res));
      expect([...levels].sort()).toEqual([5, 6, 7, 8]);
      const flippedCells = new Set(
        fixture.cells.filter((c) => c.weeks.some((w) => w.expected.flipped)).map((c) => c.cell),
      );
      expect(flippedCells.size).toBeGreaterThan(5);
      for (const state of states) {
        if (!flippedCells.has(bigIntToCell(state.h3_r9))) continue;
        for (const column of ['h3_r8', 'h3_r7', 'h3_r6', 'h3_r5'] as const) {
          expect(
            parents.some((p) => p.h3 === state[column]),
            column,
          ).toBe(true);
        }
      }
      console.info(
        `SC-001: ${String(checked)} parent rows equal deriveParentOwner over their children`,
      );
    });

    it('snapshots the leaderboards and faction stats of every week (FR-007)', async () => {
      for (const weekId of fixture.weeks) {
        // test-side: Σ capped metres per user (global) and per (faction, user)
        const global = new Map<string, number>();
        const perFaction = new Map<string, Map<string, number>>();
        for (const cell of fixture.cells) {
          const week = cell.weeks.find((w) => w.weekId === weekId)!;
          for (const c of week.expected.capped) {
            const userId = seeded.users.get(c.userId)!;
            global.set(userId, (global.get(userId) ?? 0) + c.cappedMeters);
            const byUser = perFaction.get(String(c.factionId)) ?? new Map<string, number>();
            byUser.set(userId, (byUser.get(userId) ?? 0) + c.cappedMeters);
            perFaction.set(String(c.factionId), byUser);
          }
        }
        const rank = (m: Map<string, number>) =>
          [...m.entries()]
            .filter(([, meters]) => meters > 0)
            .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
            .map(([userId, meters], i) => ({ rank: i + 1, user_id: userId, meters }));

        const { rows: globalRows } = await h.tdb.pool.query<{
          rank: number;
          user_id: string;
          meters: number;
          points: number;
        }>(
          "select rank, user_id, meters, points from leaderboard_snapshots where week_id = $1 and scope = 'global' order by rank",
          [weekId],
        );
        const expectedGlobal = rank(global);
        expect(
          globalRows.map((r) => ({ rank: r.rank, user_id: r.user_id })),
          weekId,
        ).toEqual(expectedGlobal.map((r) => ({ rank: r.rank, user_id: r.user_id })));
        for (const [i, row] of globalRows.entries()) {
          expect(row.meters).toBeCloseTo(expectedGlobal[i]!.meters, 1);
          expect(row.points).toBeGreaterThanOrEqual(0);
        }
        for (const [factionId, byUser] of perFaction) {
          const { rows } = await h.tdb.pool.query<{ rank: number; user_id: string }>(
            "select rank, user_id from leaderboard_snapshots where week_id = $1 and scope = 'faction' and scope_id = $2 order by rank",
            [weekId, factionId],
          );
          expect(rows, `${weekId} faction ${factionId}`).toEqual(
            rank(byUser).map((r) => ({ rank: r.rank, user_id: r.user_id })),
          );
        }
        const { rows: stats } = await h.tdb.pool.query<{
          faction_id: number;
          hexes_owned_r9: number;
          meters: number;
          active_users: number;
          captures: number;
        }>(
          'select faction_id, hexes_owned_r9, meters, active_users, captures from faction_stats_weekly where week_id = $1 order by faction_id',
          [weekId],
        );
        expect(stats.map((s) => s.faction_id)).toEqual([1, 2, 3]);
        for (const stat of stats) {
          const byUser = perFaction.get(String(stat.faction_id));
          const meters = byUser ? [...byUser.values()].reduce((a, b) => a + b, 0) : 0;
          expect(stat.meters, `${weekId} faction ${String(stat.faction_id)}`).toBeCloseTo(
            meters,
            1,
          );
          // active users count bonus rows too (they are contributions of the week)
          const bonusUsers = fixture.cells.some((c) =>
            c.weeks
              .find((w) => w.weekId === weekId)!
              .bonuses.some((b) => b.factionId === stat.faction_id),
          )
            ? 1
            : 0;
          expect(stat.active_users).toBe((byUser?.size ?? 0) + bonusUsers);
          expect(stat.captures).toBe(0);
        }
        // hexes owned after the last week equal the fixture's final owners
        if (weekId === fixture.weeks[fixture.weeks.length - 1]) {
          for (const stat of stats) {
            const owned = fixture.cells.filter(
              (c) => c.weeks[c.weeks.length - 1]!.expected.owner === stat.faction_id,
            ).length;
            expect(stat.hexes_owned_r9, `faction ${String(stat.faction_id)}`).toBe(owned);
          }
        }
      }
    });

    it('awards flip XP (+15) once per beneficiary and records done reckonings', async () => {
      const { rows: ledger } = await h.tdb.pool.query<{
        user_id: string;
        week_id: string;
        h3_r9: string;
        faction_id: number;
        points: number;
        ref_type: string;
        n: string;
      }>(
        "select user_id, week_id, h3_r9, faction_id, points, ref_type, count(*)::text as n from points_ledger where kind = 'hex_flip' group by 1,2,3,4,5,6 order by 2,3,1",
      );
      const expected: string[] = [];
      for (const cell of fixture.cells) {
        for (const week of cell.weeks) {
          const to = week.expected.event?.to;
          if (to === undefined || to === null) continue;
          const walkers = new Set(
            week.expected.capped
              .filter((c) => c.factionId === to && c.cappedMeters > 0)
              .map((c) => seeded.users.get(c.userId)!),
          );
          for (const userId of walkers) expected.push(`${week.weekId} ${cell.cell} ${userId}`);
        }
      }
      expect(
        ledger.map((r) => `${r.week_id} ${bigIntToCell(r.h3_r9)} ${r.user_id}`).sort(),
      ).toEqual(expected.sort());
      for (const row of ledger) {
        expect(row.n).toBe('1');
        expect(row.points).toBe(15);
        expect(row.ref_type).toBe('hex_ownership_event');
      }
      // users.xp equals the sum of their flip rows (no walk XP was seeded)
      const { rows: xp } = await h.tdb.pool.query<{ id: string; xp: number }>(
        'select id, xp from users where xp > 0',
      );
      const perUser = new Map<string, number>();
      for (const line of expected)
        perUser.set(line.split(' ')[2]!, (perUser.get(line.split(' ')[2]!) ?? 0) + 15);
      expect(new Map(xp.map((r) => [r.id, r.xp]))).toEqual(perUser);

      const { rows: reckonings } = await h.tdb.pool.query<{
        week_id: string;
        status: string;
        stage: string;
        batches: number;
        hexes_processed: number;
        attempt: number;
      }>(
        'select week_id, status, stage, batches, hexes_processed, attempt from reckonings order by week_id',
      );
      expect(reckonings).toEqual(
        fixture.weeks.map((week_id) => ({
          week_id,
          status: 'done',
          stage: 'done',
          batches: Math.ceil(fixture.cells.length / 4),
          hexes_processed: fixture.cells.length,
          attempt: 1,
        })),
      );
      expect(RULES.DECAY).toBe(0.5); // the arithmetic itself is the rules package's (Constitution II)
    });
  },
);
