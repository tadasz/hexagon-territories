import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseTrack, simulate, SAMPLE_TRACKS } from '@nature/walk-sim';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { walkSessions } from '../../src/db/schema/index.js';
import type { WalkListPage, WalkSummary } from '../../src/modules/walks/schemas.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';
import { createWalkFor, userWithFaction, walkThrough, type WalkUser } from '../helpers/walks.js';

describeWithDb('GET /v1/walks and GET /v1/walks/{id} (SC-007)', () => {
  let h: IntegrationHarness;
  let owner: WalkUser;
  let other: WalkUser;
  let finishedWalkId: string;
  let activeWalkId: string;

  beforeAll(async () => {
    h = await createIntegrationHarness();
    owner = await userWithFaction(h, 'history-owner', 1);
    other = await userWithFaction(h, 'history-other', 2);
    // 43 plain rows (fast) + one finished walk through the API + one active walk = 45
    const base = new Date('2026-08-01T08:00:00.000Z').getTime();
    await h.tdb.db.insert(walkSessions).values(
      Array.from({ length: 43 }, (_, i) => ({
        userId: owner.userId,
        clientWalkId: randomUUID(),
        factionId: 1,
        startedAt: new Date(base + i * 3_600_000),
        endedAt: new Date(base + i * 3_600_000 + 1_800_000),
        finishedAt: new Date(base + i * 3_600_000 + 1_800_000),
        status: i % 7 === 3 ? ('flagged' as const) : ('finished' as const),
        finishReason: i % 5 === 0 ? ('autofinish' as const) : ('client' as const),
        weekId: '2026-W31',
        distanceM: 1_000 + i,
        durationS: 1_800,
        hexCount: 3,
        xpAwarded: 10,
        scored: i % 7 !== 3,
        flags: i % 7 === 3 ? ['speed' as const] : [],
      })),
    );
    await h.tdb.db.insert(walkSessions).values(
      Array.from({ length: 3 }, (_, i) => ({
        userId: other.userId,
        clientWalkId: randomUUID(),
        factionId: 2,
        startedAt: new Date(base + i * 3_600_000 + 60_000),
        status: 'finished' as const,
      })),
    );
    const sim = simulate(
      parseTrack(readFileSync(SAMPLE_TRACKS.laisvesAlejaStraight, 'utf8'), 'gpx'),
    );
    finishedWalkId = (await walkThrough(h, owner, sim.samples, sim.pedometerSteps)).walkId;
    activeWalkId = (await createWalkFor(h, owner, { startedAt: '2026-09-07T09:30:00.000Z' }))
      .walkId;
  });
  afterAll(async () => {
    await h?.close();
  });

  async function page(user: WalkUser, query = ''): Promise<WalkListPage> {
    const res = await h.app.inject({ url: `/v1/walks${query}`, headers: user.headers });
    expect(res.statusCode, res.body).toBe(200);
    return res.json<WalkListPage>();
  }

  it("lists only the owner's walks newest first in pages of 20 with a cursor", async () => {
    const first = await page(owner);
    expect(first.items).toHaveLength(20);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(first.items[0]).toMatchObject({
      walkId: activeWalkId,
      status: 'active',
      finishReason: null,
      weekId: null,
      distanceM: 0,
      hexCount: 0,
      xp: 0,
      scored: false,
      flags: [],
    });
    expect(first.items[1]).toMatchObject({
      walkId: finishedWalkId,
      status: 'finished',
      weekId: '2026-W37',
    });
    expect(first.items[0]).not.toHaveProperty('hexes');
    expect(first.items[0]).not.toHaveProperty('path');

    const second = await page(owner, `?cursor=${first.nextCursor!}`);
    expect(second.items).toHaveLength(20);
    const third = await page(owner, `?cursor=${second.nextCursor!}`);
    expect(third.items).toHaveLength(5);
    expect(third.nextCursor).toBeNull();

    const all = [...first.items, ...second.items, ...third.items];
    expect(new Set(all.map((w) => w.walkId)).size).toBe(45);
    const starts = all.map((w) => w.startedAt);
    expect(starts).toEqual([...starts].sort().reverse());
    const flagged = all.filter((w) => w.status === 'flagged');
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.every((w) => w.flags.includes('speed') && !w.scored)).toBe(true);

    const theirs = await page(other);
    expect(theirs.items).toHaveLength(3);
    expect(theirs.nextCursor).toBeNull();
    expect(theirs.items.every((w) => !all.some((mine) => mine.walkId === w.walkId))).toBe(true);
  });

  it('honours limit 1–50 and rejects a malformed cursor or limit with 400', async () => {
    const small = await page(owner, '?limit=1');
    expect(small.items).toHaveLength(1);
    const big = await page(owner, '?limit=50');
    expect(big.items).toHaveLength(45);
    expect(big.nextCursor).toBeNull();
    for (const bad of [
      '?limit=0',
      '?limit=51',
      '?cursor=%2A%2A',
      `?cursor=${Buffer.from('nope').toString('base64url')}`,
    ]) {
      const res = await h.app.inject({ url: `/v1/walks${bad}`, headers: owner.headers });
      expect(res.statusCode, bad).toBe(400);
      expect(res.json()).toMatchObject({
        error: {
          code: 'VALIDATION_FAILED',
          details: { field: bad.includes('limit') ? 'limit' : 'cursor' },
        },
      });
    }
    const anonymous = await h.app.inject({ url: '/v1/walks' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('returns the detail with a GeoJSON path and sorted hexes to the owner only', async () => {
    const res = await h.app.inject({ url: `/v1/walks/${finishedWalkId}`, headers: owner.headers });
    expect(res.statusCode).toBe(200);
    const detail = res.json<WalkSummary>();
    expect(detail.path?.type).toBe('LineString');
    expect(detail.path!.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(detail.path!.coordinates[0]).toEqual([
      expect.closeTo(23.904, 2),
      expect.closeTo(54.8964, 2),
    ]);
    const cells = detail.hexes.map((x) => x.h3);
    expect(cells).toEqual([...cells].sort());
    expect(cells.length).toBeGreaterThanOrEqual(5);
    expect(detail.hexes.every((x) => x.meters > 0 && x.cappedMeters > 0)).toBe(true);

    const active = await h.app.inject({ url: `/v1/walks/${activeWalkId}`, headers: owner.headers });
    expect(active.json<WalkSummary>()).toMatchObject({
      status: 'active',
      hexes: [],
      path: null,
      endedAt: null,
      finishedAt: null,
      weekId: null,
      scored: false,
    });

    const foreign = await h.app.inject({
      url: `/v1/walks/${finishedWalkId}`,
      headers: other.headers,
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ error: { code: 'WALK_NOT_FOUND' } });
    const unknown = await h.app.inject({
      url: `/v1/walks/${randomUUID()}`,
      headers: owner.headers,
    });
    expect(unknown.statusCode).toBe(404);
  });
});
