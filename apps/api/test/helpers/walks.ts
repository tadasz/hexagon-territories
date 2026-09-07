import { randomUUID } from 'node:crypto';
import type { Sample } from '@nature/territory-rules';
import { planBatches } from '@nature/walk-sim';
import { expect } from 'vitest';
import type {
  SampleBatchResult,
  WalkCreated,
  WalkCreateRequest,
  WalkFinishRequest,
  WalkSummary,
} from '../../src/modules/walks/schemas.js';
import { bearer, bearerFor, signInTestUser } from './auth.js';
import type { IntegrationHarness } from './integration.js';

export interface WalkUser {
  userId: string;
  headers: { authorization: string };
}

/** A signed-in player with a faction (`POST /v1/me/faction`); `factionId: null` skips the pick. */
export async function userWithFaction(
  h: IntegrationHarness,
  sub: string,
  factionId: number | null = 1,
): Promise<WalkUser> {
  const user = await signInTestUser(h.app, h.apple, { sub, name: sub, clock: h.clock });
  const headers = bearer(user.tokens);
  if (factionId !== null) {
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/me/faction',
      headers,
      payload: { factionId },
    });
    expect(res.statusCode, res.body).toBe(200);
  }
  return { userId: user.userId, headers };
}

/** A fresh access token for the user at the (possibly moved) harness clock. */
export async function refreshed(h: IntegrationHarness, user: WalkUser): Promise<WalkUser> {
  return { userId: user.userId, headers: await bearerFor(h, user.userId) };
}

export async function createWalkFor(
  h: IntegrationHarness,
  user: WalkUser,
  body: Partial<WalkCreateRequest> & { startedAt: string },
): Promise<WalkCreated> {
  const res = await h.app.inject({
    method: 'POST',
    url: '/v1/walks',
    headers: user.headers,
    payload: { clientWalkId: randomUUID(), ...body },
  });
  expect([200, 201], res.body).toContain(res.statusCode);
  return res.json<WalkCreated>();
}

export type DeliveryOrder = 'in-order' | 'reversed' | 'redeliver';

export interface ReplayTrackOptions {
  /** `in-order` (default): batches ascending; `reversed`: last batch first; `redeliver`: every batch twice. */
  order?: DeliveryOrder;
  /** Fixed samples per batch; default: the walk-sim plan (one batch per 60 s window, ≤ 200). */
  batchSize?: number;
  /** Fail on any non-200 answer (default true). */
  strict?: boolean;
}

/** Posts the samples through `POST /v1/walks/{id}/samples` in batches; returns every answer. */
export async function replayTrack(
  h: IntegrationHarness,
  user: WalkUser,
  walkId: string,
  samples: readonly Sample[],
  opts: ReplayTrackOptions = {},
): Promise<SampleBatchResult[]> {
  let batches: Sample[][] = [];
  if (opts.batchSize === undefined) {
    batches = planBatches(samples);
  } else {
    for (let i = 0; i < samples.length; i += opts.batchSize) {
      batches.push(samples.slice(i, i + opts.batchSize));
    }
  }
  if (opts.order === 'reversed') batches = batches.slice().reverse();
  if (opts.order === 'redeliver') batches = batches.flatMap((batch) => [batch, batch]);
  const results: SampleBatchResult[] = [];
  for (const batch of batches) {
    const res = await h.app.inject({
      method: 'POST',
      url: `/v1/walks/${walkId}/samples`,
      headers: user.headers,
      payload: { samples: batch },
    });
    if (opts.strict !== false) expect(res.statusCode, res.body).toBe(200);
    results.push(res.json<SampleBatchResult>());
  }
  return results;
}

export async function finishWalkFor(
  h: IntegrationHarness,
  user: WalkUser,
  walkId: string,
  body: WalkFinishRequest,
): Promise<WalkSummary> {
  const res = await h.app.inject({
    method: 'POST',
    url: `/v1/walks/${walkId}/finish`,
    headers: user.headers,
    payload: body,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<WalkSummary>();
}

/** Create → replay → finish for a simulated track; the samples' timestamps drive the walk. */
export async function walkThrough(
  h: IntegrationHarness,
  user: WalkUser,
  samples: readonly Sample[],
  pedometerSteps: number | null,
  opts: ReplayTrackOptions & { clientWalkId?: string; endedAt?: string } = {},
): Promise<{ walkId: string; batches: SampleBatchResult[]; summary: WalkSummary }> {
  const first = samples[0]?.ts ?? h.clock.now().toISOString();
  const last = samples[samples.length - 1]?.ts ?? first;
  const created = await createWalkFor(h, user, {
    clientWalkId: opts.clientWalkId ?? randomUUID(),
    startedAt: first,
  });
  const batches = await replayTrack(h, user, created.walkId, samples, opts);
  const summary = await finishWalkFor(h, user, created.walkId, {
    endedAt: opts.endedAt ?? last,
    pedometerTotal: pedometerSteps,
  });
  return { walkId: created.walkId, batches, summary };
}
