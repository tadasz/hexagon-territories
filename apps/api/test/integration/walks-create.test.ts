import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { locationSamples, walkSessions } from '../../src/db/schema/index.js';
import type { WalkCreated } from '../../src/modules/walks/schemas.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';
import { createWalkFor, replayTrack, userWithFaction, type WalkUser } from '../helpers/walks.js';

describeWithDb('POST /v1/walks (research.md R3)', () => {
  let h: IntegrationHarness;

  beforeAll(async () => {
    h = await createIntegrationHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  const at = (minutesAgo: number) =>
    new Date(h.clock.now().getTime() - minutesAgo * 60_000).toISOString();

  async function post(user: WalkUser, payload: Record<string, unknown>) {
    return h.app.inject({ method: 'POST', url: '/v1/walks', headers: user.headers, payload });
  }

  it('creates once (201) and repeats idempotently (200) for the same clientWalkId', async () => {
    const user = await userWithFaction(h, 'create-idempotent', 2);
    const clientWalkId = randomUUID();
    const first = await post(user, {
      clientWalkId,
      startedAt: at(30),
      deviceInfo: { model: 'iPhone14,5', osVersion: '17.5', appVersion: '0.3.0' },
    });
    expect(first.statusCode, first.body).toBe(201);
    const created = first.json<WalkCreated>();
    expect(created).toEqual({
      walkId: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
      clientWalkId,
      startedAt: at(30),
      status: 'active',
      supersededWalkId: null,
    });

    const again = await post(user, { clientWalkId, startedAt: at(10) });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json<WalkCreated>()).toEqual(created);

    const [row] = await h.tdb.db
      .select()
      .from(walkSessions)
      .where(eq(walkSessions.userId, user.userId));
    expect(row).toMatchObject({
      clientWalkId,
      factionId: 2,
      status: 'active',
      deviceInfo: { model: 'iPhone14,5', osVersion: '17.5', appVersion: '0.3.0' },
      scored: false,
      xpAwarded: 0,
      finishReason: null,
    });
    expect(
      await h.tdb.db.select().from(walkSessions).where(eq(walkSessions.userId, user.userId)),
    ).toHaveLength(1);
  });

  it('clamps startedAt to [now − 12 h, now + 5 min]', async () => {
    const user = await userWithFaction(h, 'create-clamp');
    const past = await createWalkFor(h, user, { startedAt: '2026-09-01T00:00:00.000Z' });
    expect(past.startedAt).toBe('2026-09-06T22:00:00.000Z');
    const future = await createWalkFor(h, user, { startedAt: '2026-09-09T00:00:00.000Z' });
    expect(future.startedAt).toBe('2026-09-07T10:05:00.000Z');
    expect(future.supersededWalkId).toBe(past.walkId);
  });

  it('refuses players without a faction with 403 FACTION_REQUIRED', async () => {
    const user = await userWithFaction(h, 'create-no-faction', null);
    const res = await post(user, { clientWalkId: randomUUID(), startedAt: at(1) });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: { code: 'FACTION_REQUIRED' } });
    expect(
      await h.tdb.db.select().from(walkSessions).where(eq(walkSessions.userId, user.userId)),
    ).toHaveLength(0);
  });

  it('supersedes a stale active walk (finished and scored as superseded)', async () => {
    const user = await userWithFaction(h, 'create-supersede');
    const stale = await createWalkFor(h, user, { startedAt: at(180) });
    const base = new Date(at(170)).getTime();
    const samples = Array.from({ length: 12 }, (_, i) => ({
      seq: i,
      ts: new Date(base + i * 5_000).toISOString(),
      lat: 54.9035 + i * 0.00007,
      lon: 23.932,
      hAcc: 8,
      speed: 1.5,
    }));
    await replayTrack(h, user, stale.walkId, samples);

    const fresh = await createWalkFor(h, user, { startedAt: at(60) });
    expect(fresh.supersededWalkId).toBe(stale.walkId);
    expect(fresh.status).toBe('active');

    const [row] = await h.tdb.db
      .select()
      .from(walkSessions)
      .where(eq(walkSessions.id, stale.walkId));
    expect(row).toMatchObject({
      status: 'finished',
      finishReason: 'superseded',
      scored: true,
      weekId: '2026-W37',
      sampleCount: 12,
    });
    expect(row?.endedAt?.toISOString()).toBe(samples[11]!.ts);
    expect(row?.distanceM).toBeGreaterThan(80);
    expect(row?.hexCount).toBeGreaterThanOrEqual(1);
    const detail = await h.app.inject({ url: `/v1/walks/${stale.walkId}`, headers: user.headers });
    expect(detail.json()).toMatchObject({ finishReason: 'superseded', status: 'finished' });
    const stored = await h.tdb.db
      .select()
      .from(locationSamples)
      .where(eq(locationSamples.walkId, stale.walkId));
    expect(stored.every((s) => s.accepted)).toBe(true);
  });

  it('refuses a creation overlapping the active walk with 409 WALK_OVERLAP', async () => {
    const user = await userWithFaction(h, 'create-overlap');
    const active = await createWalkFor(h, user, { startedAt: at(60) });
    const sampleTs = at(10);
    await replayTrack(h, user, active.walkId, [
      { seq: 0, ts: at(50), lat: 54.9, lon: 23.9, hAcc: 8 },
      { seq: 1, ts: sampleTs, lat: 54.9001, lon: 23.9, hAcc: 8 },
    ]);
    const res = await post(user, { clientWalkId: randomUUID(), startedAt: at(30) });
    expect(res.statusCode, res.body).toBe(409);
    expect(res.json()).toMatchObject({
      error: {
        code: 'WALK_OVERLAP',
        details: { activeWalkId: active.walkId, lastActivityAt: sampleTs },
      },
    });
    // exactly at the last activity is still an overlap; one second later is not
    const same = await post(user, { clientWalkId: randomUUID(), startedAt: sampleTs });
    expect(same.statusCode).toBe(409);
    const later = await post(user, {
      clientWalkId: randomUUID(),
      startedAt: new Date(new Date(sampleTs).getTime() + 1_000).toISOString(),
    });
    expect(later.statusCode, later.body).toBe(201);
    expect(later.json<WalkCreated>().supersededWalkId).toBe(active.walkId);
  });

  it('rate limits the 21st creation in an hour per player with the 429 envelope', async () => {
    const user = await userWithFaction(h, 'create-rate');
    for (let i = 0; i < 20; i += 1) {
      const res = await post(user, { clientWalkId: randomUUID(), startedAt: at(200 - i) });
      expect(res.statusCode, `creation ${String(i + 1)}: ${res.body}`).toBe(201);
    }
    const blocked = await post(user, { clientWalkId: randomUUID(), startedAt: at(1) });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({
      error: { code: 'RATE_LIMITED', details: { max: 20 } },
    });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    // another player is not affected (keyed by user, not by address)
    const other = await userWithFaction(h, 'create-rate-other');
    const ok = await post(other, { clientWalkId: randomUUID(), startedAt: at(1) });
    expect(ok.statusCode).toBe(201);
  });

  it('validates the body (400 VALIDATION_FAILED with details.field) and needs a token', async () => {
    const user = await userWithFaction(h, 'create-validate');
    const missing = await post(user, { startedAt: at(1) });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { field: 'clientWalkId' } },
    });
    const badDevice = await post(user, {
      clientWalkId: randomUUID(),
      startedAt: at(1),
      deviceInfo: { model: 'x'.repeat(65) },
    });
    expect(badDevice.statusCode).toBe(400);
    expect(badDevice.json()).toMatchObject({ error: { details: { field: 'deviceInfo' } } });
    const anonymous = await h.app.inject({
      method: 'POST',
      url: '/v1/walks',
      payload: { clientWalkId: randomUUID(), startedAt: at(1) },
    });
    expect(anonymous.statusCode).toBe(401);
  });
});
