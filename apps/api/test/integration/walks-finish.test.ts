import { readFileSync } from 'node:fs';
import { expected, parseTrack, simulate, SAMPLE_TRACKS, type Expected } from '@nature/walk-sim';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  antiCheatFlags,
  hexFactionStrength,
  hexState,
  hexWeekContribution,
  pointsLedger,
  users,
  walkHexMeters,
  walkSessions,
} from '../../src/db/schema/index.js';
import { bigIntToCell, cellToBigInt } from '../../src/lib/h3.js';
import type { WalkSummary } from '../../src/modules/walks/schemas.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';
import {
  createWalkFor,
  finishWalkFor,
  replayTrack,
  userWithFaction,
  walkThrough,
  type DeliveryOrder,
  type WalkUser,
} from '../helpers/walks.js';

/** SC-001: server per-cell metres and contributions equal the oracle within this. */
const ORACLE_TOLERANCE_M = 0.05;
const ORDERS: DeliveryOrder[] = ['in-order', 'redeliver', 'reversed'];

function loadTrack(path: string) {
  return simulate(parseTrack(readFileSync(path, 'utf8'), 'gpx'));
}

const POLYGON_WKT =
  'POLYGON((23.884 54.895,23.888 54.895,23.888 54.898,23.884 54.898,23.884 54.895))';

describeWithDb('POST /v1/walks/{id}/finish — the only scoring path (SC-001, SC-005)', () => {
  let h: IntegrationHarness;
  let maxDeviationM = 0;

  beforeAll(async () => {
    h = await createIntegrationHarness();
  });
  afterAll(async () => {
    console.info(`SC-001: max deviation from the walk-sim oracle ${maxDeviationM.toFixed(4)} m`);
    await h?.close();
  });

  async function hexRows(walkId: string) {
    const rows = await h.tdb.db
      .select()
      .from(walkHexMeters)
      .where(eq(walkHexMeters.walkId, walkId));
    return rows
      .map((r) => ({ cell: bigIntToCell(r.h3R9), meters: r.meters, cappedMeters: r.cappedMeters }))
      .sort((a, b) => (a.cell < b.cell ? -1 : 1));
  }

  async function contributions(userId: string, weekId?: string) {
    const rows = await h.tdb.db
      .select()
      .from(hexWeekContribution)
      .where(
        weekId
          ? and(eq(hexWeekContribution.userId, userId), eq(hexWeekContribution.weekId, weekId))
          : eq(hexWeekContribution.userId, userId),
      );
    return rows
      .map((r) => ({
        cell: bigIntToCell(r.h3R9),
        weekId: r.weekId,
        factionId: r.factionId,
        meters: r.meters,
        cappedMeters: r.cappedMeters,
        walks: r.walks,
      }))
      .sort((a, b) => (a.cell < b.cell ? -1 : 1));
  }

  async function ledger(userId: string) {
    return h.tdb.db.select().from(pointsLedger).where(eq(pointsLedger.userId, userId));
  }

  function assertMatchesOracle(summary: WalkSummary, oracle: Expected, scored: boolean) {
    expect(summary.flags).toEqual(oracle.flags);
    expect(summary.hexes.map((x) => x.h3)).toEqual(oracle.hexes.map((x) => x.cell));
    expect(Math.abs(summary.distanceM - oracle.distanceM)).toBeLessThanOrEqual(ORACLE_TOLERANCE_M);
    for (const want of oracle.hexes) {
      const got = summary.hexes.find((x) => x.h3 === want.cell)!;
      const deviation = Math.abs(got.meters - want.meters);
      maxDeviationM = Math.max(maxDeviationM, deviation);
      expect(deviation, want.cell).toBeLessThanOrEqual(ORACLE_TOLERANCE_M);
      expect(got.cappedMeters).toBeCloseTo(scored ? Math.min(want.meters, 2000) : 0, 3);
    }
    expect(summary.sampleCount).toBe(oracle.acceptedSeqs.length + oracle.rejected.length);
  }

  for (const [key, path] of Object.entries(SAMPLE_TRACKS)) {
    it(`${key}: replay in order, re-delivered and reversed scores exactly the oracle`, async () => {
      const sim = loadTrack(path);
      const oracle = expected(sim.samples, sim.pedometerSteps);
      const scored = oracle.flags.length === 0;
      const results: {
        order: DeliveryOrder;
        user: WalkUser;
        walkId: string;
        summary: WalkSummary;
      }[] = [];
      for (const order of ORDERS) {
        const user = await userWithFaction(h, `finish-${key}-${order}`, 1);
        const { walkId, summary } = await walkThrough(h, user, sim.samples, sim.pedometerSteps, {
          order,
        });
        results.push({ order, user, walkId, summary });

        expect(summary).toMatchObject({
          walkId,
          status: scored ? 'finished' : 'flagged',
          finishReason: 'client',
          scored,
          weekId: '2026-W37',
          startedAt: sim.samples[0]!.ts,
          endedAt: sim.samples[sim.samples.length - 1]!.ts,
          finishedAt: h.clock.now().toISOString(),
          steps: sim.pedometerSteps,
          hexCount: oracle.hexes.length,
        });
        expect(summary.path).toEqual({
          type: 'LineString',
          coordinates: expect.arrayContaining([]) as unknown[],
        });
        expect(summary.path?.coordinates).toHaveLength(oracle.simplifiedPointCount);
        expect(summary.durationS).toBe(
          Math.round((Date.parse(summary.endedAt!) - Date.parse(summary.startedAt)) / 1000),
        );
        assertMatchesOracle(summary, oracle, scored);

        // stored per-cell metres
        const stored = await hexRows(walkId);
        expect(stored.map((r) => r.cell)).toEqual(oracle.hexes.map((x) => x.cell));
        for (const want of oracle.hexes) {
          const row = stored.find((r) => r.cell === want.cell)!;
          expect(Math.abs(row.meters - want.meters)).toBeLessThanOrEqual(ORACLE_TOLERANCE_M);
        }
        // weekly contributions
        const rows = await contributions(user.userId);
        if (scored) {
          expect(rows.map((r) => r.cell)).toEqual(oracle.hexes.map((x) => x.cell));
          for (const want of oracle.hexes) {
            const row = rows.find((r) => r.cell === want.cell)!;
            expect(row).toMatchObject({ weekId: '2026-W37', factionId: 1, walks: 1 });
            expect(Math.abs(row.meters - want.meters)).toBeLessThanOrEqual(ORACLE_TOLERANCE_M);
            expect(Math.abs(row.cappedMeters - Math.min(want.meters, 2000))).toBeLessThanOrEqual(
              ORACLE_TOLERANCE_M,
            );
          }
          expect(summary.xp).toBe(Math.floor(oracle.distanceM / 100));
          const rowsLedger = await ledger(user.userId);
          expect(rowsLedger).toHaveLength(1);
          expect(rowsLedger[0]).toMatchObject({
            kind: 'walk_distance',
            points: summary.xp,
            refType: 'walk',
            refId: walkId,
            weekId: '2026-W37',
            factionId: 1,
          });
          const [player] = await h.tdb.db
            .select({ xp: users.xp })
            .from(users)
            .where(eq(users.id, user.userId));
          expect(player?.xp).toBe(summary.xp);
          expect(
            await h.tdb.db
              .select()
              .from(antiCheatFlags)
              .where(eq(antiCheatFlags.userId, user.userId)),
          ).toHaveLength(0);
        } else {
          expect(rows).toEqual([]);
          expect(summary.xp).toBe(0);
          expect(await ledger(user.userId)).toEqual([]);
          const flags = await h.tdb.db
            .select()
            .from(antiCheatFlags)
            .where(eq(antiCheatFlags.walkId, walkId));
          expect(flags.map((f) => f.code).sort()).toEqual([...oracle.flags].sort());
          expect(flags[0]?.details).toMatchObject({
            distanceM: expect.any(Number) as number,
            durationS: expect.any(Number) as number,
            medianSpeedMps: expect.any(Number) as number,
            steps: sim.pedometerSteps,
            sampleCount: sim.samples.length,
          });
          expect(flags.every((f) => f.resolvedAt === null)).toBe(true);
        }
        // the samples' final accepted/rejected state equals the oracle
        const { rows: states } = await h.tdb.pool.query<{
          seq: number;
          accepted: boolean;
          reject_reason: string | null;
        }>(
          'select seq, accepted, reject_reason from location_samples where walk_id = $1 order by seq',
          [walkId],
        );
        expect(states.filter((s) => s.accepted).map((s) => s.seq)).toEqual(oracle.acceptedSeqs);
        expect(
          states.filter((s) => !s.accepted).map((s) => ({ seq: s.seq, reason: s.reject_reason })),
        ).toEqual(oracle.rejected);
      }

      // identical across the three deliveries (walk ids and users aside)
      const strip = (s: WalkSummary) => ({
        distanceM: s.distanceM,
        durationS: s.durationS,
        xp: s.xp,
        flags: s.flags,
        weekId: s.weekId,
        hexes: s.hexes.map((x) => [x.h3, x.meters, x.cappedMeters]),
        path: s.path,
        sampleCount: s.sampleCount,
      });
      expect(strip(results[1]!.summary)).toEqual(strip(results[0]!.summary));
      expect(strip(results[2]!.summary)).toEqual(strip(results[0]!.summary));
      expect(await hexRows(results[1]!.walkId)).toEqual(await hexRows(results[0]!.walkId));
      expect(await hexRows(results[2]!.walkId)).toEqual(await hexRows(results[0]!.walkId));
    });
  }

  it("applies the 2 000 m weekly cap across the player's walks in a cell", async () => {
    const sim = loadTrack(SAMPLE_TRACKS.azuolynasLoop);
    const oracle = expected(sim.samples, sim.pedometerSteps);
    const target = oracle.hexes.reduce((a, b) => (b.meters > a.meters ? b : a));
    expect(target.meters).toBeGreaterThan(200);
    const user = await userWithFaction(h, 'finish-cap', 1);
    await h.tdb.db.insert(hexWeekContribution).values({
      h3R9: cellToBigInt(target.cell),
      weekId: '2026-W37',
      factionId: 1,
      userId: user.userId,
      meters: 1_800,
      cappedMeters: 1_800,
      walks: 3,
    });
    const { walkId, summary } = await walkThrough(h, user, sim.samples, sim.pedometerSteps);
    const hex = summary.hexes.find((x) => x.h3 === target.cell)!;
    expect(hex.meters).toBeCloseTo(target.meters, 1);
    expect(hex.cappedMeters).toBeCloseTo(200, 3);
    const [row] = (await contributions(user.userId)).filter((r) => r.cell === target.cell);
    expect(row).toMatchObject({ cappedMeters: 2_000, walks: 4 });
    expect(row?.meters).toBeCloseTo(1_800 + target.meters, 1);
    // the other cells are uncapped and the stored counted metres survive a read
    const detail = await h.app.inject({ url: `/v1/walks/${walkId}`, headers: user.headers });
    expect(detail.json<WalkSummary>().hexes).toEqual(summary.hexes);
    // a second identical walk earns nothing more in the capped cell
    const second = await walkThrough(h, user, sim.samples, sim.pedometerSteps);
    expect(second.summary.hexes.find((x) => x.h3 === target.cell)?.cappedMeters).toBe(0);
  });

  it('credits a walk crossing Monday 00:00 UTC entirely to the new week', async () => {
    const track = parseTrack(readFileSync(SAMPLE_TRACKS.laisvesAlejaStraight, 'utf8'), 'gpx');
    const crossing = simulate(track, { startAt: '2026-09-06T23:50:00.000Z' });
    expect(crossing.samples[crossing.samples.length - 1]!.ts > '2026-09-07T00:00:00.000Z').toBe(
      true,
    );
    const user = await userWithFaction(h, 'finish-week-boundary', 2);
    const { summary } = await walkThrough(h, user, crossing.samples, crossing.pedometerSteps);
    expect(summary.weekId).toBe('2026-W37');
    expect(summary.startedAt).toBe('2026-09-06T23:50:00.000Z');
    const rows = await contributions(user.userId);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.weekId === '2026-W37')).toBe(true);
    expect((await ledger(user.userId))[0]?.weekId).toBe('2026-W37');

    // ... and one that ends before the cutoff belongs to the old week
    const sunday = simulate(track, { startAt: '2026-09-06T23:30:00.000Z' });
    expect(sunday.samples[sunday.samples.length - 1]!.ts < '2026-09-07T00:00:00.000Z').toBe(true);
    const other = await userWithFaction(h, 'finish-week-sunday', 2);
    const result = await walkThrough(h, other, sunday.samples, sunday.pedometerSteps);
    expect(result.summary.weekId).toBe('2026-W36');
    expect((await contributions(other.userId)).every((r) => r.weekId === '2026-W36')).toBe(true);
  });

  it('clamps endedAt to [last accepted sample, now] and rejects endedAt before startedAt', async () => {
    const sim = loadTrack(SAMPLE_TRACKS.laisvesAlejaStraight);
    const lastTs = sim.samples[sim.samples.length - 1]!.ts;
    const user = await userWithFaction(h, 'finish-clamp', 1);

    const late = await walkThrough(h, user, sim.samples, sim.pedometerSteps, {
      endedAt: '2026-09-07T12:00:00.000Z',
    });
    expect(late.summary.endedAt).toBe(h.clock.now().toISOString());

    const early = await walkThrough(h, user, sim.samples, sim.pedometerSteps, {
      endedAt: sim.samples[5]!.ts,
    });
    expect(early.summary.endedAt).toBe(lastTs);

    const walk = await createWalkFor(h, user, { startedAt: sim.samples[0]!.ts });
    const res = await h.app.inject({
      method: 'POST',
      url: `/v1/walks/${walk.walkId}/finish`,
      headers: user.headers,
      payload: { endedAt: '2026-09-07T07:00:00.000Z' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: 'INVALID_ENDED_AT', details: { startedAt: sim.samples[0]!.ts } },
    });
    const [row] = await h.tdb.db
      .select()
      .from(walkSessions)
      .where(eq(walkSessions.id, walk.walkId));
    expect(row?.status).toBe('active');
  });

  it('caps walking XP at 300 per UTC day and still writes a ledger row when capped out', async () => {
    const sim = loadTrack(SAMPLE_TRACKS.azuolynasLoop);
    const oracle = expected(sim.samples, sim.pedometerSteps);
    const walkXp = Math.floor(oracle.distanceM / 100);
    expect(walkXp).toBeGreaterThan(10);
    const user = await userWithFaction(h, 'finish-xp-cap', 3);
    await h.tdb.db.insert(pointsLedger).values([
      {
        userId: user.userId,
        factionId: 3,
        kind: 'walk_distance',
        points: 200,
        createdAt: new Date('2026-09-07T01:00:00Z'),
      },
      {
        userId: user.userId,
        factionId: 3,
        kind: 'walk_distance',
        points: 90,
        createdAt: new Date('2026-09-07T09:00:00Z'),
      },
      {
        userId: user.userId,
        factionId: 3,
        kind: 'walk_distance',
        points: 300,
        createdAt: new Date('2026-09-06T23:59:59Z'),
      },
      {
        userId: user.userId,
        factionId: 3,
        kind: 'capture_bird',
        points: 300,
        createdAt: new Date('2026-09-07T09:30:00Z'),
      },
    ]);
    await h.tdb.db.update(users).set({ xp: 890 }).where(eq(users.id, user.userId));

    const first = await walkThrough(h, user, sim.samples, sim.pedometerSteps);
    expect(first.summary.xp).toBe(10);
    const second = await walkThrough(h, user, sim.samples, sim.pedometerSteps);
    expect(second.summary.xp).toBe(0);
    expect(second.summary.scored).toBe(true);
    const rows = (await ledger(user.userId)).filter((r) => r.refType === 'walk');
    expect(rows.map((r) => r.points).sort()).toEqual([0, 10]);
    const [player] = await h.tdb.db
      .select({ xp: users.xp })
      .from(users)
      .where(eq(users.id, user.userId));
    expect(player?.xp).toBe(900);
  });

  it('answers the stored summary on a second finish without scoring twice', async () => {
    const sim = loadTrack(SAMPLE_TRACKS.laisvesAlejaStraight);
    const user = await userWithFaction(h, 'finish-idempotent', 1);
    const { walkId, summary } = await walkThrough(h, user, sim.samples, sim.pedometerSteps);
    h.clock.advanceMinutes(5);
    const again = await finishWalkFor(h, user, walkId, {
      endedAt: '2026-09-07T09:59:00.000Z',
      pedometerTotal: 1,
    });
    expect(again).toEqual(summary);
    expect(await ledger(user.userId)).toHaveLength(1);
    expect((await contributions(user.userId)).every((r) => r.walks === 1)).toBe(true);
    const [player] = await h.tdb.db
      .select({ xp: users.xp })
      .from(users)
      .where(eq(users.id, user.userId));
    expect(player?.xp).toBe(summary.xp);
    const detail = await h.app.inject({ url: `/v1/walks/${walkId}`, headers: user.headers });
    expect(detail.json<WalkSummary>()).toEqual(summary);
  });

  it('reports the week standing per cell from strength, contributions and ownership', async () => {
    // A synthetic 700 m walk north in a corner of the map no other test touches, so the
    // expectations can be computed by hand from the oracle's per-cell metres.
    const samples = Array.from({ length: 100 }, (_, i) => ({
      seq: i,
      ts: new Date(Date.parse('2026-09-07T09:00:00.000Z') + i * 5_000).toISOString(),
      lat: 54.95 + i * 0.000063,
      lon: 24.05,
      hAcc: 8,
      speed: 1.4,
    }));
    const oracle = expected(samples, 900);
    expect(oracle.flags).toEqual([]);
    expect(oracle.hexes.length).toBeGreaterThanOrEqual(2);
    const [cellA, cellB] = oracle.hexes.map((x) => x.cell) as [string, string];
    const metersA = oracle.hexes[0]!.meters;
    const metersB = oracle.hexes[1]!.meters;
    await h.tdb.db.insert(hexFactionStrength).values([
      { h3R9: cellToBigInt(cellA), factionId: 2, strength: 3_000, lastReckonedWeek: '2026-W36' },
      { h3R9: cellToBigInt(cellA), factionId: 1, strength: 100, lastReckonedWeek: '2026-W36' },
    ]);
    await h.tdb.db.insert(hexState).values({
      h3R9: cellToBigInt(cellA),
      h3R8: 0n,
      h3R7: 0n,
      h3R6: 0n,
      h3R5: 0n,
      geom: POLYGON_WKT,
      ownerFactionId: 2,
      ownerSinceWeek: '2026-W36',
    });
    const rival = await userWithFaction(h, 'finish-standing-rival', 3);
    await h.tdb.db.insert(hexWeekContribution).values({
      h3R9: cellToBigInt(cellB),
      weekId: '2026-W37',
      factionId: 3,
      userId: rival.userId,
      meters: 400,
      cappedMeters: 400,
      captureBonusM: 300,
      walks: 1,
    });

    const user = await userWithFaction(h, 'finish-standing', 1);
    const { summary } = await walkThrough(h, user, samples, 900);
    expect(summary.scored).toBe(true);
    const a = summary.hexes.find((x) => x.h3 === cellA)!;
    const totalA = 1_500 + 50 + metersA;
    expect(a.weekStanding).toEqual({
      leader: 2,
      myFactionShare: Math.round(((50 + metersA) / totalA) * 1000) / 1000,
      owner: 2,
    });
    const b = summary.hexes.find((x) => x.h3 === cellB)!;
    expect(b.weekStanding.owner).toBeNull();
    expect(b.weekStanding.leader).toBe(metersB > 700 ? 1 : 3);
    expect(b.weekStanding.myFactionShare).toBeCloseTo(metersB / (700 + metersB), 3);
    for (const hex of summary.hexes.slice(2)) {
      expect(hex.weekStanding).toEqual({ leader: 1, myFactionShare: 1, owner: null });
    }
    // a read answers the same standing, and nothing here wrote ownership (Constitution II)
    const detail = await h.app.inject({
      url: `/v1/walks/${summary.walkId}`,
      headers: user.headers,
    });
    expect(detail.json<WalkSummary>().hexes).toEqual(summary.hexes);
    const [state] = await h.tdb.db
      .select()
      .from(hexState)
      .where(eq(hexState.h3R9, cellToBigInt(cellA)));
    expect(state?.ownerFactionId).toBe(2);
  });

  it('finishes a walk with fewer than two accepted samples with 0 m and no flags', async () => {
    const user = await userWithFaction(h, 'finish-empty', 1);
    const one = await walkThrough(
      h,
      user,
      [
        { seq: 0, ts: '2026-09-07T09:00:00.000Z', lat: 54.9, lon: 23.9, hAcc: 8, speed: 1 },
        { seq: 1, ts: '2026-09-07T09:00:05.000Z', lat: 54.9001, lon: 23.9, hAcc: 90, speed: 1 },
      ],
      null,
    );
    expect(one.summary).toMatchObject({
      status: 'finished',
      scored: true,
      flags: [],
      distanceM: 0,
      hexCount: 0,
      hexes: [],
      path: null,
      xp: 0,
      steps: null,
      sampleCount: 2,
      endedAt: '2026-09-07T09:00:05.000Z',
      durationS: 5,
    });
    expect(await contributions(user.userId)).toEqual([]);

    const empty = await createWalkFor(h, user, { startedAt: '2026-09-07T09:30:00.000Z' });
    const summary = await finishWalkFor(h, user, empty.walkId, {
      endedAt: '2026-09-07T09:35:00.000Z',
    });
    expect(summary).toMatchObject({
      status: 'finished',
      scored: true,
      endedAt: '2026-09-07T09:35:00.000Z',
      durationS: 300,
      sampleCount: 0,
      hexes: [],
      path: null,
      xp: 0,
    });
  });

  it('credits the faction the player has at finish time', async () => {
    const sim = loadTrack(SAMPLE_TRACKS.laisvesAlejaStraight);
    const user = await userWithFaction(h, 'finish-faction-change', 1);
    const walk = await createWalkFor(h, user, { startedAt: sim.samples[0]!.ts });
    await replayTrack(h, user, walk.walkId, sim.samples);
    const change = await h.app.inject({
      method: 'POST',
      url: '/v1/me/faction',
      headers: user.headers,
      payload: { factionId: 3 },
    });
    expect(change.statusCode, change.body).toBe(200);
    const summary = await finishWalkFor(h, user, walk.walkId, {
      endedAt: sim.samples[sim.samples.length - 1]!.ts,
    });
    expect(summary.scored).toBe(true);
    const rows = await contributions(user.userId);
    expect(rows.every((r) => r.factionId === 3)).toBe(true);
    expect((await ledger(user.userId))[0]?.factionId).toBe(3);
    const [row] = await h.tdb.db
      .select()
      .from(walkSessions)
      .where(eq(walkSessions.id, walk.walkId));
    expect(row?.factionId).toBe(3);
  });

  it('answers 404 for foreign or unknown walks and 400 for a malformed body', async () => {
    const owner = await userWithFaction(h, 'finish-owner', 1);
    const walk = await createWalkFor(h, owner, { startedAt: '2026-09-07T09:00:00.000Z' });
    const other = await userWithFaction(h, 'finish-other', 1);
    const foreign = await h.app.inject({
      method: 'POST',
      url: `/v1/walks/${walk.walkId}/finish`,
      headers: other.headers,
      payload: { endedAt: '2026-09-07T09:10:00.000Z' },
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ error: { code: 'WALK_NOT_FOUND' } });
    const invalid = await h.app.inject({
      method: 'POST',
      url: `/v1/walks/${walk.walkId}/finish`,
      headers: owner.headers,
      payload: { endedAt: 'yesterday' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { field: 'endedAt' } },
    });
  });
});
