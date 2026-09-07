import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { pointsLedger, walkSessions } from '../../src/db/schema/index.js';
import { runWalkAutofinish, type WalkAutofinishDeps } from '../../src/jobs/walk-autofinish.js';
import type { WalkSummary } from '../../src/modules/walks/schemas.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';
import {
  createWalkFor,
  finishWalkFor,
  refreshed,
  replayTrack,
  userWithFaction,
} from '../helpers/walks.js';

describeWithDb('walk.autofinish (research.md R9, SC-005)', () => {
  let h: IntegrationHarness;

  beforeAll(async () => {
    h = await createIntegrationHarness({ now: '2026-09-07T10:00:00.000Z' });
  });
  afterAll(async () => {
    await h?.close();
  });

  const deps = (): WalkAutofinishDeps => ({ db: h.tdb.db, clock: h.clock, log: h.app.log });

  it('finishes walks active for more than 12 h, idempotently and safely next to a client finish', async () => {
    // one active walk per player (a second creation would supersede the first), so three players
    const user = await userWithFaction(h, 'autofinish', 1);
    const idle = await userWithFaction(h, 'autofinish-idle', 1);
    const newcomer = await userWithFaction(h, 'autofinish-newcomer', 2);
    const withSamples = await createWalkFor(h, user, { startedAt: '2026-09-07T09:00:00.000Z' });
    const base = Date.parse('2026-09-07T09:00:00.000Z');
    const samples = Array.from({ length: 40 }, (_, i) => ({
      seq: i,
      ts: new Date(base + i * 5_000).toISOString(),
      lat: 54.9035 + i * 0.00006,
      lon: 23.932 + i * 0.00002,
      hAcc: i === 39 ? 90 : 8,
      speed: 1.4,
    }));
    await replayTrack(h, user, withSamples.walkId, samples);
    const lastAccepted = samples[38]!.ts;
    const withoutSamples = await createWalkFor(h, idle, { startedAt: '2026-09-07T09:40:00.000Z' });

    // nothing is stale yet
    expect(await runWalkAutofinish(deps())).toEqual({ finished: 0, failed: 0, walkIds: [] });

    h.clock.advanceMs(13 * 3_600_000); // 2026-09-07T23:00Z
    const later = await refreshed(h, user);
    const fresh = await createWalkFor(h, await refreshed(h, newcomer), {
      startedAt: '2026-09-07T22:30:00.000Z',
    });
    const result = await runWalkAutofinish(deps());
    expect(result.finished).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.walkIds.sort()).toEqual([withSamples.walkId, withoutSamples.walkId].sort());

    const [scored] = await h.tdb.db
      .select()
      .from(walkSessions)
      .where(eq(walkSessions.id, withSamples.walkId));
    expect(scored).toMatchObject({
      status: 'finished',
      finishReason: 'autofinish',
      scored: true,
      weekId: '2026-W37',
    });
    expect(scored?.endedAt?.toISOString()).toBe(lastAccepted);
    expect(scored?.finishedAt?.toISOString()).toBe(h.clock.now().toISOString());
    expect(scored?.distanceM).toBeGreaterThan(200);
    expect(scored?.hexCount).toBeGreaterThanOrEqual(1);
    expect(scored?.xpAwarded).toBe(Math.floor((scored?.distanceM ?? 0) / 100));

    const [empty] = await h.tdb.db
      .select()
      .from(walkSessions)
      .where(eq(walkSessions.id, withoutSamples.walkId));
    expect(empty).toMatchObject({
      status: 'finished',
      finishReason: 'autofinish',
      distanceM: 0,
      hexCount: 0,
    });
    expect(empty?.endedAt?.toISOString()).toBe('2026-09-07T09:40:00.000Z');

    const [untouched] = await h.tdb.db
      .select()
      .from(walkSessions)
      .where(eq(walkSessions.id, fresh.walkId));
    expect(untouched?.status).toBe('active');

    // second run: nothing left
    expect(await runWalkAutofinish(deps())).toEqual({ finished: 0, failed: 0, walkIds: [] });

    // a late client finish gets the stored summary and scores nothing twice
    const summary = await finishWalkFor(h, later, withSamples.walkId, {
      endedAt: '2026-09-07T09:05:00.000Z',
      pedometerTotal: 500,
    });
    expect(summary).toMatchObject({
      finishReason: 'autofinish',
      endedAt: lastAccepted,
      steps: null,
      xp: scored?.xpAwarded,
    });
    expect(summary.finishedAt).toBe(scored?.finishedAt?.toISOString());
    const ledger = await h.tdb.db
      .select()
      .from(pointsLedger)
      .where(eq(pointsLedger.userId, user.userId));
    expect(ledger.filter((r) => r.refId === withSamples.walkId)).toHaveLength(1);
    const detail = await h.app.inject({
      url: `/v1/walks/${withSamples.walkId}`,
      headers: later.headers,
    });
    expect(detail.json<WalkSummary>()).toEqual(summary);
  });

  it('runs through the registered pg-boss worker and honours WALK_AUTOFINISH_AFTER_H', async () => {
    const user = await refreshed(h, await userWithFaction(h, 'autofinish-worker', 2));
    const walk = await createWalkFor(h, user, { startedAt: h.clock.now().toISOString() });
    h.clock.advanceMs(13 * 3_600_000);
    const handler = h.boss.handlers.get('walk.autofinish');
    expect(handler).toBeDefined();
    await handler!([{ id: 'job-af-1', name: 'walk.autofinish', data: {} }]);
    const [row] = await h.tdb.db
      .select()
      .from(walkSessions)
      .where(eq(walkSessions.id, walk.walkId));
    expect(row).toMatchObject({ status: 'finished', finishReason: 'autofinish' });

    const short = await createWalkFor(h, await refreshed(h, user), {
      startedAt: h.clock.now().toISOString(),
    });
    h.clock.advanceMs(2 * 3_600_000);
    expect((await runWalkAutofinish({ ...deps(), afterH: 1 })).walkIds).toEqual([short.walkId]);
  });
});
