import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { locationSamples, walkSessions } from '../../src/db/schema/index.js';
import type { SampleBatchResult } from '../../src/modules/walks/schemas.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';
import {
  createWalkFor,
  finishWalkFor,
  replayTrack,
  userWithFaction,
  type WalkUser,
} from '../helpers/walks.js';

describeWithDb('POST /v1/walks/{id}/samples (research.md R2, R10)', () => {
  let h: IntegrationHarness;

  beforeAll(async () => {
    h = await createIntegrationHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  const START = '2026-09-07T08:00:00.000Z';
  const ts = (i: number) => new Date(Date.parse(START) + i * 5_000).toISOString();
  const sample = (seq: number, extra: Record<string, unknown> = {}) => ({
    seq,
    ts: ts(seq),
    lat: 54.9035 + seq * 0.00006,
    lon: 23.932,
    hAcc: 8,
    speed: 1.4,
    ...extra,
  });

  async function newWalk(sub: string) {
    const user = await userWithFaction(h, sub);
    const walk = await createWalkFor(h, user, { startedAt: START });
    return { user, walkId: walk.walkId };
  }

  async function post(user: WalkUser, walkId: string, payload: Record<string, unknown>) {
    return h.app.inject({
      method: 'POST',
      url: `/v1/walks/${walkId}/samples`,
      headers: user.headers,
      payload,
    });
  }

  async function storedSeqs(walkId: string) {
    const rows = await h.tdb.db
      .select({ seq: locationSamples.seq })
      .from(locationSamples)
      .where(eq(locationSamples.walkId, walkId))
      .orderBy(locationSamples.seq);
    return rows.map((r) => r.seq);
  }

  it('refuses more than 200 samples with 400 VALIDATION_FAILED and details.field samples', async () => {
    const { user, walkId } = await newWalk('samples-201');
    const res = await post(user, walkId, {
      samples: Array.from({ length: 201 }, (_, i) => sample(i)),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED', details: { field: 'samples' } },
    });
    const empty = await post(user, walkId, { samples: [] });
    expect(empty.statusCode).toBe(400);
    expect(await storedSeqs(walkId)).toEqual([]);
  });

  it('stores a batch once: re-delivery answers stored 0 / duplicates n and keeps one row per seq', async () => {
    const { user, walkId } = await newWalk('samples-redeliver');
    const samples = Array.from({ length: 30 }, (_, i) => sample(i));
    const [first, again] = await replayTrack(h, user, walkId, samples, {
      order: 'redeliver',
      batchSize: 30,
    });
    expect(first).toEqual({
      stored: 30,
      duplicates: 0,
      accepted: samples.map((s) => s.seq),
      rejected: [],
      sampleCount: 30,
    });
    expect(again).toEqual({
      stored: 0,
      duplicates: 30,
      accepted: [],
      rejected: [],
      sampleCount: 30,
    });
    expect(await storedSeqs(walkId)).toEqual(samples.map((s) => s.seq));
    // a partially overlapping batch stores only the new seqs
    const partial = await post(user, walkId, {
      samples: [sample(28), sample(29), sample(30), sample(31), sample(31)],
    });
    expect(partial.json<SampleBatchResult>()).toEqual({
      stored: 2,
      duplicates: 3,
      accepted: [30, 31],
      rejected: [],
      sampleCount: 32,
    });
    const [walk] = await h.tdb.db.select().from(walkSessions).where(eq(walkSessions.id, walkId));
    expect(walk?.sampleCount).toBe(32);
  });

  it('accepts batches in any order without duplicating rows', async () => {
    const { user, walkId } = await newWalk('samples-reversed');
    const samples = Array.from({ length: 50 }, (_, i) => sample(i));
    const results = await replayTrack(h, user, walkId, samples, {
      order: 'reversed',
      batchSize: 20,
    });
    expect(results.map((r) => r.stored)).toEqual([10, 20, 20]);
    expect(results[2]?.sampleCount).toBe(50);
    expect(await storedSeqs(walkId)).toEqual(samples.map((s) => s.seq));
    const { rows } = await h.tdb.pool.query<{ n: string }>(
      'select count(*)::text as n from location_samples where walk_id = $1',
      [walkId],
    );
    expect(rows[0]?.n).toBe('50');
  });

  it('answers the provisional filter result with reasons, across batch boundaries', async () => {
    const { user, walkId } = await newWalk('samples-provisional');
    const first = await post(user, walkId, {
      samples: [sample(0), sample(1), sample(2, { hAcc: 80 }), sample(3), sample(4, { speed: 6 })],
    });
    expect(first.json<SampleBatchResult>()).toEqual({
      stored: 5,
      duplicates: 0,
      accepted: [0, 1, 3],
      rejected: [
        { seq: 2, reason: 'accuracy' },
        { seq: 4, reason: 'speed' },
      ],
      sampleCount: 5,
    });
    // seq 5 is timestamped before seq 3 (the last accepted stored sample) → non_monotonic
    const second = await post(user, walkId, {
      samples: [
        sample(5, { ts: ts(2) }),
        sample(6),
        sample(7, { speed: null }),
        sample(8, { hAcc: 50 }),
      ],
    });
    expect(second.json<SampleBatchResult>()).toEqual({
      stored: 4,
      duplicates: 0,
      accepted: [6, 7, 8],
      rejected: [{ seq: 5, reason: 'non_monotonic' }],
      sampleCount: 9,
    });
    const rows = await h.tdb.db
      .select({
        seq: locationSamples.seq,
        accepted: locationSamples.accepted,
        reason: locationSamples.rejectReason,
      })
      .from(locationSamples)
      .where(eq(locationSamples.walkId, walkId))
      .orderBy(locationSamples.seq);
    expect(rows).toEqual([
      { seq: 0, accepted: true, reason: null },
      { seq: 1, accepted: true, reason: null },
      { seq: 2, accepted: false, reason: 'accuracy' },
      { seq: 3, accepted: true, reason: null },
      { seq: 4, accepted: false, reason: 'speed' },
      { seq: 5, accepted: false, reason: 'non_monotonic' },
      { seq: 6, accepted: true, reason: null },
      { seq: 7, accepted: true, reason: null },
      { seq: 8, accepted: true, reason: null },
    ]);
  });

  it('sums pedometer windows into steps only when the batch stored something', async () => {
    const { user, walkId } = await newWalk('samples-pedometer');
    const pedometer = { steps: 40, since: ts(0), until: ts(5) };
    await post(user, walkId, { samples: [sample(0), sample(1)], pedometer });
    await post(user, walkId, { samples: [sample(0), sample(1)], pedometer });
    await post(user, walkId, { samples: [sample(2)], pedometer: { ...pedometer, steps: 10 } });
    const [walk] = await h.tdb.db.select().from(walkSessions).where(eq(walkSessions.id, walkId));
    expect(walk?.steps).toBe(50);
  });

  it('refuses a finished walk with 409 WALK_NOT_ACTIVE and a foreign walk with 404', async () => {
    const { user, walkId } = await newWalk('samples-finished');
    await post(user, walkId, { samples: [sample(0), sample(1)] });
    await finishWalkFor(h, user, walkId, { endedAt: ts(1) });
    const late = await post(user, walkId, { samples: [sample(2)] });
    expect(late.statusCode).toBe(409);
    expect(late.json()).toMatchObject({
      error: { code: 'WALK_NOT_ACTIVE', details: { status: 'finished' } },
    });

    const other = await userWithFaction(h, 'samples-foreign');
    const foreign = await post(other, walkId, { samples: [sample(2)] });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ error: { code: 'WALK_NOT_FOUND' } });
    const unknown = await post(other, '00000000-0000-4000-8000-000000000000', {
      samples: [sample(0)],
    });
    expect(unknown.statusCode).toBe(404);
    const malformed = await post(other, 'not-a-uuid', { samples: [sample(0)] });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toMatchObject({ error: { details: { field: 'id' } } });
    expect(await storedSeqs(walkId)).toEqual([0, 1]);
  });

  it('rate limits the 31st batch in 15 minutes with 429 RATE_LIMITED and retry-after', async () => {
    const { user, walkId } = await newWalk('samples-rate');
    for (let i = 0; i < 30; i += 1) {
      const res = await post(user, walkId, { samples: [sample(i)] });
      expect(res.statusCode, `batch ${String(i + 1)}: ${res.body}`).toBe(200);
    }
    const blocked = await post(user, walkId, { samples: [sample(30)] });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({
      error: { code: 'RATE_LIMITED', details: { max: 30 } },
    });
    const retryAfter = Number(blocked.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(15 * 60);
    expect(await storedSeqs(walkId)).toHaveLength(30);
  });

  it('enforces the daily quota of 8 640 stored samples with 429 SAMPLE_QUOTA_EXCEEDED', async () => {
    const { user, walkId } = await newWalk('samples-quota');
    // an earlier, finished walk of the same UTC day already stored 8 635 samples
    await h.tdb.db.insert(walkSessions).values({
      userId: user.userId,
      clientWalkId: randomUUID(),
      factionId: 1,
      startedAt: new Date('2026-09-07T01:00:00.000Z'),
      status: 'finished',
      sampleCount: 8_635,
    });
    const ok = await post(user, walkId, {
      samples: [sample(0), sample(1), sample(2), sample(3), sample(4)],
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const blocked = await post(user, walkId, { samples: [sample(5)] });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({
      error: {
        code: 'SAMPLE_QUOTA_EXCEEDED',
        details: { retryAfterS: 14 * 3600, samplesPerDay: 8640, storedToday: 8640 },
      },
    });
    expect(blocked.headers['retry-after']).toBe(String(14 * 3600));
    // re-delivering already stored samples never counts against the quota
    const redelivered = await post(user, walkId, { samples: [sample(0), sample(1)] });
    expect(redelivered.statusCode).toBe(200);
    expect(redelivered.json<SampleBatchResult>()).toMatchObject({ stored: 0, duplicates: 2 });
    expect(await storedSeqs(walkId)).toEqual([0, 1, 2, 3, 4]);
    const { rows } = await h.tdb.pool.query<{ n: string }>(
      'select count(*)::text as n from location_samples where walk_id = $1',
      [walkId],
    );
    expect(rows[0]?.n).toBe('5');
  });
});
