import { describe, expect, it } from 'vitest';
import type { ReckoningQueued, ReckoningRunResult } from '../src/api-types.js';
import { ApiError, formatReckonResult, reckon } from '../src/reckon.js';

interface Call {
  method: string;
  url: string;
  body: unknown;
  auth: string | undefined;
}

const RESULT: ReckoningRunResult = {
  weekId: '2026-W36',
  dryRun: true,
  status: 'done',
  resumed: false,
  hexesProcessed: 128,
  flips: 2,
  parentFlips: 1,
  walksAutofinished: 0,
  staleWalksSkipped: 1,
  pushQueued: 0,
  leaderboardRows: 0,
  durationMs: 843,
  startedAt: '2026-09-07T10:12:00.000Z',
  finishedAt: '2026-09-07T10:12:00.843Z',
  flipsPreview: [
    { h3: '891f40d1a4fffff', from: 1, to: 2 },
    { h3: '891f40d1a57ffff', from: null, to: 3 },
  ],
};

function fakeApi(status: number, payload: unknown) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      method: init?.method ?? 'GET',
      url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null,
      auth: headers.get('authorization') ?? undefined,
    });
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  return { calls, fetch: fetchImpl };
}

describe('reckon (feature 004, data-model.md §4)', () => {
  it('posts the week to the admin endpoint with the bearer token and sync by default', async () => {
    const api = fakeApi(200, { ...RESULT, dryRun: false });
    const result = await reckon({
      baseUrl: 'http://api.test/',
      token: 'admin-jwt',
      weekId: '2026-W36',
      fetch: api.fetch,
    });
    expect(result).toMatchObject({ weekId: '2026-W36', status: 'done', dryRun: false });
    expect(api.calls).toEqual([
      {
        method: 'POST',
        url: 'http://api.test/v1/admin/reckonings/2026-W36',
        body: { dryRun: false, sync: true },
        auth: 'Bearer admin-jwt',
      },
    ]);
  });

  it('a dry run implies sync and returns the flips preview', async () => {
    const api = fakeApi(200, RESULT);
    const result = (await reckon({
      baseUrl: 'http://api.test',
      token: 't',
      weekId: '2026-W36',
      dryRun: true,
      sync: false,
      fetch: api.fetch,
    })) as ReckoningRunResult;
    expect(api.calls[0]?.body).toEqual({ dryRun: true, sync: true });
    expect(result.flipsPreview).toHaveLength(2);
    expect(formatReckonResult(result)).toEqual([
      '891f40d1a4fffff 1 → 2',
      '891f40d1a57ffff - → 3',
      '2026-W36 (dry run): 128 cells, 2 flips, 1 parent flips, 0 walks auto-finished, 0 pushes queued, 843 ms — 1 stale walks would be finished first by a real run',
    ]);
  });

  it('returns the queued job on 202 and formats it', async () => {
    const queued: ReckoningQueued = { weekId: '2026-W36', status: 'queued', jobId: 'job-9' };
    const api = fakeApi(202, queued);
    const result = await reckon({
      baseUrl: 'http://api.test',
      token: 't',
      weekId: '2026-W36',
      sync: false,
      fetch: api.fetch,
    });
    expect(result).toEqual(queued);
    expect(api.calls[0]?.body).toEqual({ dryRun: false, sync: false });
    expect(formatReckonResult(result)).toEqual([
      '2026-W36: queued as job job-9 (poll GET /v1/admin/reckonings/2026-W36)',
    ]);
  });

  it('throws ApiError with the envelope code on any other status', async () => {
    const forbidden = fakeApi(403, {
      error: {
        code: 'FORBIDDEN',
        message: 'Requires role admin',
        details: { requiredRole: 'admin' },
      },
      requestId: 'r',
    });
    await expect(
      reckon({
        baseUrl: 'http://api.test',
        token: 'player',
        weekId: '2026-W36',
        fetch: forbidden.fetch,
      }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      code: 'FORBIDDEN',
      status: 403,
      details: { requiredRole: 'admin' },
    });
    const outOfOrder = fakeApi(409, {
      error: {
        code: 'RECKONING_OUT_OF_ORDER',
        message: 'x',
        details: { expectedWeekId: '2026-W35' },
      },
      requestId: 'r',
    });
    await expect(
      reckon({
        baseUrl: 'http://api.test',
        token: 't',
        weekId: '2026-W36',
        fetch: outOfOrder.fetch,
      }),
    ).rejects.toBeInstanceOf(ApiError);
    const html = {
      calls: [] as Call[],
      fetch: (() => Promise.resolve(new Response('<h1>502</h1>', { status: 502 }))) as typeof fetch,
    };
    await expect(
      reckon({ baseUrl: 'http://api.test', token: 't', weekId: '2026-W36', fetch: html.fetch }),
    ).rejects.toMatchObject({ code: 'HTTP_502', status: 502 });
  });
});
