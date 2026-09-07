import { loadFixture, type ReckoningWeeksFixture } from '@nature/h3-fixtures';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  pushStartAfter,
  type ReckoningResultPush,
} from '../../src/modules/territory/reckoning/push.js';
import { asJobBoss, fakeBoss } from '../helpers/auth.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';
import {
  reckoningDeps,
  runFixtureWeek,
  seedFixtureWeeks,
  type SeededFixture,
} from '../helpers/reckoning.js';

const fixture: ReckoningWeeksFixture = loadFixture('reckoning-weeks');
const [W35, W36] = fixture.weeks as [string, string];

describeWithDb(
  'push stage: one queued result per contributing player (FR-008, research.md R15)',
  () => {
    let h: IntegrationHarness;
    let seeded: SeededFixture;

    beforeAll(async () => {
      h = await createIntegrationHarness({ captureLogs: true });
      seeded = await seedFixtureWeeks(h.tdb, fixture);
    });
    afterAll(async () => {
      await h?.close();
    });

    function contributorsOf(weekIndex: number): Set<string> {
      const users = new Set<string>();
      for (const cell of fixture.cells) {
        const week = cell.weeks[weekIndex]!;
        for (const c of week.contributions) users.add(seeded.users.get(c.userId)!);
        for (const b of week.bonuses) users.add(seeded.bonusUsers.get(b.factionId)!);
      }
      return users;
    }

    it('queues one push.send row per contributor with flips, lost captaincies, singleton key and start time', async () => {
      const boss = fakeBoss();
      const deps = reckoningDeps(h.tdb, h.clock, { boss: asJobBoss(boss) });
      const first = await runFixtureWeek(deps, W35, h.clock);
      const contributors = contributorsOf(0);
      expect(first.pushQueued).toBe(contributors.size);
      const sent = boss.sent.filter((s) => s.name === 'push.send');
      expect(sent).toHaveLength(contributors.size);
      for (const job of sent) {
        const data = job.data as ReckoningResultPush;
        expect(contributors.has(data.userId)).toBe(true);
        expect(data).toMatchObject({ kind: 'reckoning_result', weekId: W35, lost: 0 });
        expect(job.options).toEqual({
          singletonKey: `reckoning:${W35}:${data.userId}`,
          startAfter: pushStartAfter(W35),
          expireInHours: 23,
          retentionDays: 14,
        });
      }
      expect(pushStartAfter(W35).toISOString()).toBe('2026-08-31T08:00:00.000Z');
      // flips per player equal their hex_flip ledger rows of the week
      const { rows } = await h.tdb.pool.query<{ user_id: string; n: string }>(
        "select user_id, count(*)::text as n from points_ledger where kind = 'hex_flip' and week_id = $1 group by user_id",
        [W35],
      );
      const flipsByUser = new Map(rows.map((r) => [r.user_id, Number(r.n)]));
      for (const job of sent) {
        const data = job.data as ReckoningResultPush;
        expect(data.flips, data.userId).toBe(flipsByUser.get(data.userId) ?? 0);
      }
      expect(sent.some((s) => (s.data as ReckoningResultPush).flips > 0)).toBe(true);

      // W36: challenger-beats-hysteresis flips 1 → 2, so its W35 captain (u1) lost a captaincy
      const second = await runFixtureWeek(deps, W36, h.clock);
      const w36 = boss.sent.filter(
        (s) => s.name === 'push.send' && (s.data as ReckoningResultPush).weekId === W36,
      );
      expect(w36).toHaveLength(second.pushQueued);
      expect(second.pushQueued).toBe(contributorsOf(1).size);
      const u1 = w36.find(
        (s) => (s.data as ReckoningResultPush).userId === seeded.users.get('u1'),
      )!;
      const lostCells = fixture.cells.filter(
        (c) => c.weeks[1]!.expected.flipped && c.weeks[0]!.expected.captain === 'u1',
      );
      expect(lostCells.length).toBeGreaterThan(0);
      expect((u1.data as ReckoningResultPush).lost).toBe(lostCells.length);
    });

    it('adds no push on a rerun of a done week and skips with a log line when jobs are disabled', async () => {
      const boss = fakeBoss();
      const again = await runFixtureWeek(
        reckoningDeps(h.tdb, h.clock, { boss: asJobBoss(boss) }),
        W36,
        h.clock,
      );
      expect(again.pushQueued).toBe(contributorsOf(1).size); // stored count
      expect(boss.sent).toEqual([]);

      const before = h.logLines.length;
      const deps = reckoningDeps(h.tdb, h.clock, { boss: null, log: h.app.log });
      const third = await runFixtureWeek(deps, fixture.weeks[2]!, h.clock);
      expect(third.pushQueued).toBe(0);
      const skipped = h.logLines
        .slice(before)
        .find((line) => line.includes('result pushes skipped'));
      expect(skipped).toBeDefined();
      expect(JSON.parse(skipped!)).toMatchObject({ level: 40, players: contributorsOf(2).size });
    });
  },
);
