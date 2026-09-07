import { loadFixture, type ReckoningWeeksFixture } from '@nature/h3-fixtures';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { ReckoningLatest } from '../../src/modules/territory/schemas.js';
import { bearerFor } from '../helpers/auth.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';
import {
  reckoningDeps,
  runFixtureWeek,
  seedFixtureWeeks,
  seedUser,
  type SeededFixture,
} from '../helpers/reckoning.js';

const fixture: ReckoningWeeksFixture = loadFixture('reckoning-weeks');
const [W35, W36] = fixture.weeks as [string, string];

describeWithDb('GET /v1/reckonings/latest (FR-013, research.md R11)', () => {
  let h: IntegrationHarness;
  let seeded: SeededFixture;
  let bystander: string;

  beforeAll(async () => {
    h = await createIntegrationHarness({ now: '2026-09-02T12:00:00.000Z' }); // Wednesday of W36
    seeded = await seedFixtureWeeks(h.tdb, fixture);
    bystander = await seedUser(h.tdb, 'bystander', 3);
  });
  afterAll(async () => {
    await h?.close();
  });

  it('answers null week fields, empty totals and the next Monday before any reckoning', async () => {
    const res = await h.app.inject({
      url: '/v1/reckonings/latest',
      headers: await bearerFor(h, bystander),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=60');
    expect(res.json<ReckoningLatest>()).toEqual({
      weekId: null,
      ranAt: null,
      nextAt: '2026-09-07T00:00:00.000Z',
      inProgress: null,
      factionTotals: [],
      myFlips: 0,
      myFlippedHexes: [],
    });
    const anonymous = await h.app.inject({ url: '/v1/reckonings/latest' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('after two reckonings reports the latest week, totals with flips gained/lost and my flips', async () => {
    const deps = reckoningDeps(h.tdb, h.clock);
    await runFixtureWeek(deps, W35, h.clock);
    const second = await runFixtureWeek(deps, W36, h.clock);
    h.clock.set('2026-09-09T08:00:00.000Z'); // Wednesday of W37

    // u2 walked for the challengers of W36 and helped flip three cells (u1 flipped none that week)
    const u2 = seeded.users.get('u2')!;
    const res = await h.app.inject({
      url: '/v1/reckonings/latest',
      headers: await bearerFor(h, u2),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<ReckoningLatest>();
    expect(body.weekId).toBe(W36);
    expect(body.ranAt).toBe(second.finishedAt);
    expect(body.nextAt).toBe('2026-09-14T00:00:00.000Z');
    expect(body.inProgress).toBeNull();
    expect(body.factionTotals.map((t) => t.factionId)).toEqual([1, 2, 3]);

    // test-side expectations from the fixture's W36 events
    const events = fixture.cells
      .map((c) => c.weeks[1]!.expected.event)
      .filter((e): e is { from: number | null; to: number | null } => e !== undefined);
    for (const total of body.factionTotals) {
      expect(total.flipsGained).toBe(events.filter((e) => e.to === total.factionId).length);
      expect(total.flipsLost).toBe(events.filter((e) => e.from === total.factionId).length);
      expect(total.hexesOwnedR9).toBe(
        fixture.cells.filter((c) => c.weeks[1]!.expected.owner === total.factionId).length,
      );
      expect(total.captures).toBe(0);
      expect(total.activeUsers).toBeGreaterThanOrEqual(0);
    }
    const myFlippedCells = fixture.cells
      .filter((c) => {
        const w = c.weeks[1]!;
        const to = w.expected.event?.to;
        return (
          to !== undefined &&
          to !== null &&
          w.expected.capped.some(
            (x) => x.factionId === to && x.userId === 'u2' && x.cappedMeters > 0,
          )
        );
      })
      .map((c) => c.cell)
      .sort();
    expect(myFlippedCells.length).toBeGreaterThan(0);
    expect(body.myFlips).toBe(myFlippedCells.length);
    expect(body.myFlippedHexes).toEqual(myFlippedCells);

    for (const other of [bystander, seeded.users.get('u1')!]) {
      const none = await h.app.inject({
        url: '/v1/reckonings/latest',
        headers: await bearerFor(h, other),
      });
      expect(none.json<ReckoningLatest>()).toMatchObject({
        weekId: W36,
        myFlips: 0,
        myFlippedHexes: [],
      });
    }
  });

  it('names a running reckoning as inProgress', async () => {
    await h.tdb.pool.query(
      "insert into reckonings (week_id, status, stage, attempt) values ('2026-W37', 'running', 'cells', 1)",
    );
    const res = await h.app.inject({
      url: '/v1/reckonings/latest',
      headers: await bearerFor(h, bystander),
    });
    expect(res.json<ReckoningLatest>()).toMatchObject({ weekId: W36, inProgress: '2026-W37' });
    await h.tdb.pool.query("delete from reckonings where week_id = '2026-W37'");
  });
});
