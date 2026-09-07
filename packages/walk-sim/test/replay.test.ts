import type { Sample } from '@nature/territory-rules';
import { describe, expect, it } from 'vitest';
import { ReplayError, batchWindowMs, planBatches, replay } from '../src/replay.js';
import { simulate } from '../src/simulate.js';

const sim = simulate(
  {
    name: 'straight',
    points: [
      { lat: 54.89, lon: 23.9 },
      { lat: 54.8976, lon: 23.9132 },
    ],
  },
  { speedMps: 1.4 },
);

interface Call {
  method: string;
  path: string;
  body: unknown;
  auth: string | undefined;
}

function fakeApi(opts: { rateLimitOnce?: boolean; failFinish?: boolean } = {}) {
  const calls: Call[] = [];
  let limited = false;
  const fetchImpl: typeof fetch = (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    calls.push({
      method: init?.method ?? 'GET',
      path: url.pathname,
      body,
      auth: headers.get('authorization') ?? undefined,
    });
    const json = (status: number, payload: unknown, extra: Record<string, string> = {}) =>
      Promise.resolve(
        new Response(JSON.stringify(payload), {
          status,
          headers: { 'content-type': 'application/json', ...extra },
        }),
      );

    if (url.pathname === '/v1/walks') {
      const b = body as { clientWalkId: string; startedAt: string };
      return json(201, {
        walkId: 'walk-1',
        clientWalkId: b.clientWalkId,
        startedAt: b.startedAt,
        status: 'active',
        supersededWalkId: null,
      });
    }
    if (url.pathname === '/v1/walks/walk-1/samples') {
      if (opts.rateLimitOnce && !limited) {
        limited = true;
        return json(
          429,
          {
            error: { code: 'RATE_LIMITED', message: 'slow down', details: { retryAfterS: 1 } },
            requestId: 'r',
          },
          { 'retry-after': '1' },
        );
      }
      const b = body as { samples: Sample[] };
      return json(200, {
        stored: b.samples.length,
        duplicates: 0,
        accepted: b.samples.map((s) => s.seq),
        rejected: [],
        sampleCount: b.samples.length,
      });
    }
    if (url.pathname === '/v1/walks/walk-1/finish') {
      if (opts.failFinish) {
        return json(400, { error: { code: 'INVALID_ENDED_AT', message: 'nope' }, requestId: 'r' });
      }
      return json(200, { walkId: 'walk-1', status: 'finished', hexes: [], path: null, flags: [] });
    }
    return json(404, { error: { code: 'NOT_FOUND', message: url.pathname }, requestId: 'r' });
  };
  return { calls, fetch: fetchImpl };
}

describe('planBatches', () => {
  it('fills batches of at most 200 without a window (offline drain / rate 0)', () => {
    const batches = planBatches(sim.samples);
    expect(batches.length).toBe(Math.ceil(sim.samples.length / 200));
    expect(batches.flat().map((s) => s.seq)).toEqual(sim.samples.map((s) => s.seq));
    expect(planBatches(sim.samples, 5).every((b) => b.length <= 5)).toBe(true);
    expect(planBatches(sim.samples, 1000).every((b) => b.length <= 200)).toBe(true);
    expect(planBatches([], 10)).toEqual([]);
  });

  it('closes a batch every window of sample time, keeping seq ascending', () => {
    const batches = planBatches(sim.samples, 200, 60_000);
    expect(batches.length).toBeGreaterThan(5);
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(12);
      const span = Date.parse(batch[batch.length - 1]!.ts) - Date.parse(batch[0]!.ts);
      expect(span).toBeLessThan(60_000);
      for (let i = 1; i < batch.length; i += 1)
        expect(batch[i]!.seq).toBeGreaterThan(batch[i - 1]!.seq);
    }
    expect(batches.flat().map((s) => s.seq)).toEqual(sim.samples.map((s) => s.seq));
    expect(batchWindowMs(0)).toBe(Number.POSITIVE_INFINITY);
    expect(batchWindowMs(1)).toBe(60_000);
    expect(batchWindowMs(60)).toBe(3_600_000);
  });
});

describe('replay', () => {
  it('creates, uploads every batch in order and finishes with the bearer token', async () => {
    const api = fakeApi();
    const sleeps: number[] = [];
    const result = await replay(sim.samples, sim.pedometerSteps, {
      baseUrl: 'http://api.test/',
      token: 'tok',
      fetch: api.fetch,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      clientWalkId: 'c1d0f5d2-0000-4000-8000-000000000001',
    });
    expect(result.walkId).toBe('walk-1');
    expect(result.summary).toMatchObject({ status: 'finished' });
    expect(sleeps).toEqual([]);

    expect(api.calls[0]).toMatchObject({
      method: 'POST',
      path: '/v1/walks',
      auth: 'Bearer tok',
      body: { clientWalkId: 'c1d0f5d2-0000-4000-8000-000000000001', startedAt: sim.samples[0]!.ts },
    });
    const batchCalls = api.calls.filter((c) => c.path === '/v1/walks/walk-1/samples');
    expect(batchCalls.length).toBe(result.batches.length);
    const sent = batchCalls.flatMap((c) =>
      (c.body as { samples: Sample[] }).samples.map((s) => s.seq),
    );
    expect(sent).toEqual(sim.samples.map((s) => s.seq));
    expect(api.calls[api.calls.length - 1]).toMatchObject({
      method: 'POST',
      path: '/v1/walks/walk-1/finish',
      body: {
        endedAt: sim.samples[sim.samples.length - 1]!.ts,
        pedometerTotal: sim.pedometerSteps,
      },
    });
  });

  it('retries a 429 once after retry-after and sends no finish with finish: false', async () => {
    const api = fakeApi({ rateLimitOnce: true });
    const sleeps: number[] = [];
    const result = await replay(sim.samples, null, {
      baseUrl: 'http://api.test',
      token: 'tok',
      fetch: api.fetch,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      finish: false,
      batchSize: 50,
    });
    expect(sleeps).toEqual([1_000]);
    expect(result.summary).toBeNull();
    const batchCalls = api.calls.filter((c) => c.path === '/v1/walks/walk-1/samples');
    expect(batchCalls.length).toBe(result.batches.length + 1);
    expect(batchCalls[0]!.body).toEqual(batchCalls[1]!.body);
    expect(api.calls.some((c) => c.path.endsWith('/finish'))).toBe(false);
  });

  it('waits for the simulated clock when rate > 0', async () => {
    const api = fakeApi();
    const sleeps: number[] = [];
    await replay(sim.samples.slice(0, 40), 0, {
      baseUrl: 'http://api.test',
      token: 'tok',
      fetch: api.fetch,
      rate: 600,
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });
    // 40 samples = 195 s of walking; at 600× one batch closes per 60 s × 600 of sample time,
    // so everything goes in one batch whose send is due after 195 s / 600 ≈ 325 ms
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThan(200);
    expect(sleeps[0]).toBeLessThanOrEqual(400);
  });

  it('throws ReplayError with the envelope on any other non-2xx', async () => {
    const api = fakeApi({ failFinish: true });
    await expect(
      replay(sim.samples, 0, { baseUrl: 'http://api.test', token: 'tok', fetch: api.fetch }),
    ).rejects.toMatchObject({
      name: 'ReplayError',
      status: 400,
      body: { error: { code: 'INVALID_ENDED_AT' } },
    });
    try {
      await replay(sim.samples, 0, { baseUrl: 'http://api.test', token: 'tok', fetch: api.fetch });
    } catch (err) {
      expect(err).toBeInstanceOf(ReplayError);
      expect((err as ReplayError).message).toMatch(/finish answered 400: INVALID_ENDED_AT/);
    }
  });
});
