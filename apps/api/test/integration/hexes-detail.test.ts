import { loadFixture, type ReckoningWeeksFixture } from '@nature/h3-fixtures';
import { cellToParent } from 'h3-js';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { hexReckoningHistory, hexWeekContribution } from '../../src/db/schema/index.js';
import { cellToBigInt } from '../../src/lib/h3.js';
import type { HexDetail } from '../../src/modules/territory/schemas.js';
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

interface ErrorBody {
  error: { code: string; details?: Record<string, unknown> };
}

describeWithDb('GET /v1/hexes/{h3} (FR-012, research.md R10)', () => {
  let h: IntegrationHarness;
  let seeded: SeededFixture;

  beforeAll(async () => {
    h = await createIntegrationHarness();
    seeded = await seedFixtureWeeks(h.tdb, fixture);
    const deps = reckoningDeps(h.tdb, h.clock);
    for (const weekId of fixture.weeks) await runFixtureWeek(deps, weekId, h.clock);
    // the clock now sits in 2026-W38; the current-week pressure comes from W38 rows
    h.clock.set('2026-09-15T10:00:00.000Z');
  });
  afterAll(async () => {
    await h?.close();
  });

  it('shows owner, captain by display name, strengths, this week, my states and the history newest first', async () => {
    const cell = fixture.cells.find((c) => c.id === 'first-claim')!;
    const last = cell.weeks[cell.weeks.length - 1]!;
    const u1 = seeded.users.get('u1')!;
    // u1 walks 420 m this week for faction 1; faction 2 gets a bonus of 300 through its bonus user
    await h.tdb.db.insert(hexWeekContribution).values([
      {
        h3R9: cellToBigInt(cell.cell),
        weekId: '2026-W38',
        factionId: 1,
        userId: u1,
        meters: 420,
        cappedMeters: 420,
        walks: 1,
      },
      {
        h3R9: cellToBigInt(cell.cell),
        weekId: '2026-W38',
        factionId: 2,
        userId: seeded.bonusUsers.get(2)!,
        meters: 0,
        cappedMeters: 0,
        captureBonusM: 300,
        walks: 0,
      },
    ]);
    const res = await h.app.inject({
      url: `/v1/hexes/${cell.cell}`,
      headers: await bearerFor(h, u1),
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers['cache-control']).toBe('private, max-age=30');
    const body = res.json<HexDetail>();
    expect(body.h3).toBe(cell.cell);
    expect(body.owner).toBe(last.expected.owner);
    expect(body.ownerSince).toBe(cell.weeks[0]!.weekId);
    expect(body.captain).toEqual({ userId: u1, displayName: 'Fixture u1' });
    expect(body.strengths.map((s) => s.factionId)).toEqual(
      last.expected.strengths.map((s) => s.factionId),
    );
    expect(body.strengths[0]!.strength).toBeCloseTo(last.expected.strengths[0]!.strength, 2);
    expect(body.week.weekId).toBe('2026-W38');
    const strength1 = last.expected.strengths[0]!.strength;
    expect(body.week.factions).toEqual([
      { factionId: 1, cappedMeters: 420, bonusMeters: 0, score: strength1 * 0.5 + 420 },
      { factionId: 2, cappedMeters: 0, bonusMeters: 300, score: 300 },
    ]);
    expect(body.week.pressureLeader).toBe(1);
    expect(body.week.contested).toBe(false);
    expect(body.me).toEqual({
      meters: 420,
      cappedMeters: 420,
      explored: true,
      flipped: true,
      held: true,
    });
    expect(body.reckonings.map((r) => r.weekId)).toEqual([...fixture.weeks].reverse());
    expect(body.reckonings[2]).toMatchObject({
      weekId: fixture.weeks[0],
      owner: 1,
      flipped: true,
      from: null,
      to: 1,
      captain: { userId: u1, displayName: 'Fixture u1' },
    });
    expect(body.reckonings[0]!.strengths[0]!.strength).toBeCloseTo(strength1, 2);
    expect(body.captures).toEqual([]);
  });

  it('answers the other player with their own states and marks a contested cell', async () => {
    const cell = fixture.cells.find((c) => c.id === 'hysteresis-holds')!;
    const last = cell.weeks[cell.weeks.length - 1]!;
    expect(last.expected.owner).toBe(1);
    const u2 = seeded.users.get('u2')!; // walked for faction 1 here in W35 (part of the first claim)
    const rival = await seedUser(h.tdb, 'detail-rival', 2);
    await h.tdb.db.insert(hexWeekContribution).values({
      h3R9: cellToBigInt(cell.cell),
      weekId: '2026-W38',
      factionId: 2,
      userId: rival,
      meters: 2600,
      cappedMeters: 2000,
      walks: 2,
    });
    const res = await h.app.inject({
      url: `/v1/hexes/${cell.cell}`,
      headers: await bearerFor(h, u2),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<HexDetail>();
    expect(body.owner).toBe(1);
    expect(body.week.pressureLeader).toBe(2);
    expect(body.week.contested).toBe(true);
    expect(body.me).toEqual({
      meters: 0,
      cappedMeters: 0,
      explored: true,
      flipped: true,
      held: false,
    });
    const asRival = await h.app.inject({
      url: `/v1/hexes/${cell.cell}`,
      headers: await bearerFor(h, rival),
    });
    expect(asRival.json<HexDetail>().me).toEqual({
      meters: 2600,
      cappedMeters: 2000,
      explored: true,
      flipped: false,
      held: false,
    });
  });

  it('limits the history to the last eight reckonings, newest first', async () => {
    const cell = fixture.cells.find((c) => c.id === 'no-faction-reaches-min')!;
    // seven older weeks on top of the three fixture weeks → 10 rows, 8 returned
    const olderWeeks = [
      '2026-W28',
      '2026-W29',
      '2026-W30',
      '2026-W31',
      '2026-W32',
      '2026-W33',
      '2026-W34',
    ];
    await h.tdb.db.insert(hexReckoningHistory).values(
      olderWeeks.map((weekId) => ({
        h3R9: cellToBigInt(cell.cell),
        weekId,
        ownerFactionId: null,
        flipped: false,
        strengths: [{ factionId: 1, strength: 42 }],
      })),
    );
    const res = await h.app.inject({
      url: `/v1/hexes/${cell.cell}`,
      headers: await bearerFor(h, seeded.users.get('u1')!),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<HexDetail>();
    expect(body.reckonings).toHaveLength(8);
    expect(body.reckonings.map((r) => r.weekId)).toEqual([
      '2026-W37',
      '2026-W36',
      '2026-W35',
      '2026-W34',
      '2026-W33',
      '2026-W32',
      '2026-W31',
      '2026-W30',
    ]);
    expect(body.reckonings[7]).toEqual({
      weekId: '2026-W30',
      owner: null,
      flipped: false,
      from: null,
      to: null,
      strengths: [{ factionId: 1, strength: 42 }],
      captain: null,
    });
  });

  it('answers 200 with an empty state for a valid res-9 cell nobody has walked', async () => {
    const never = '891f40d1b8bffff';
    const me = await seedUser(h.tdb, 'detail-nobody', null);
    const res = await h.app.inject({ url: `/v1/hexes/${never}`, headers: await bearerFor(h, me) });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json<HexDetail>()).toEqual({
      h3: never,
      owner: null,
      ownerSince: null,
      captain: null,
      strengths: [],
      week: { weekId: '2026-W38', factions: [], pressureLeader: null, contested: false },
      me: { meters: 0, cappedMeters: 0, explored: false, flipped: false, held: false },
      reckonings: [],
      captures: [],
    });
  });

  it('rejects ids that are not resolution-9 cells and needs a token', async () => {
    const headers = await bearerFor(h, seeded.users.get('u1')!);
    for (const bad of [
      cellToParent(fixture.cells[0]!.cell, 8),
      '000000000000000',
      'ffffffffffffffff',
      '891F40DA99BFFFF',
    ]) {
      const res = await h.app.inject({ url: `/v1/hexes/${bad}`, headers });
      expect(res.statusCode, bad).toBe(400);
      const body = res.json<ErrorBody>();
      expect(body.error.code).toBe('VALIDATION_FAILED');
      expect(body.error.details?.field).toBe('h3');
    }
    const anonymous = await h.app.inject({ url: `/v1/hexes/${fixture.cells[0]!.cell}` });
    expect(anonymous.statusCode).toBe(401);
  });
});
