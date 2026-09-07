import { loadFixture, type ReckoningWeeksFixture } from '@nature/h3-fixtures';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type {
  ReckoningQueued,
  ReckoningRunResult,
  ReckoningStatus,
} from '../../src/modules/territory/schemas.js';
import { weekEndUtc } from '../../src/modules/territory/weeks.js';
import { bearerFor } from '../helpers/auth.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';
import {
  holdAdvisoryLock,
  seedFixtureWeeks,
  seedUser,
  tableSnapshot,
} from '../helpers/reckoning.js';

const fixture: ReckoningWeeksFixture = loadFixture('reckoning-weeks');
const [W35, W36, W37] = fixture.weeks as [string, string, string];

interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

describeWithDb('POST/GET /v1/admin/reckonings/{weekId} (FR-014, research.md R12)', () => {
  let h: IntegrationHarness;
  let adminId: string;
  let playerId: string;
  let testerId: string;
  // tokens are minted at the fake clock's time, so re-mint after the clock moves
  const admin = () => bearerFor(h, adminId, 'admin');
  const player = () => bearerFor(h, playerId);
  const tester = () => bearerFor(h, testerId, 'tester');

  beforeAll(async () => {
    h = await createIntegrationHarness({ now: '2026-09-03T09:00:00.000Z' }); // Thursday of W36
    await seedFixtureWeeks(h.tdb, fixture);
    adminId = await seedUser(h.tdb, 'the-admin', 1, 'admin');
    playerId = await seedUser(h.tdb, 'a-player', 2);
    testerId = await seedUser(h.tdb, 'a-tester', 3, 'tester');
  });
  afterAll(async () => {
    await h?.close();
  });

  const post = (weekId: string, headers: Record<string, string>, payload?: unknown) =>
    h.app.inject({
      method: 'POST',
      url: `/v1/admin/reckonings/${weekId}`,
      headers,
      payload: payload ?? {},
    });

  it('answers 403 FORBIDDEN to players and testers and 401 without a token', async () => {
    for (const headers of [await player(), await tester()]) {
      const res = await post(W35, headers, { sync: true });
      expect(res.statusCode).toBe(403);
      expect(res.json<ErrorBody>().error.code).toBe('FORBIDDEN');
      const status = await h.app.inject({ url: `/v1/admin/reckonings/${W35}`, headers });
      expect(status.statusCode).toBe(403);
    }
    const anonymous = await post(W35, {}, { sync: true });
    expect(anonymous.statusCode).toBe(401);
  });

  it('refuses a week that has not ended, an out-of-sequence week, a dry run without sync and a bad id', async () => {
    const notEnded = await post(W36, await admin(), { sync: true });
    expect(notEnded.statusCode).toBe(400);
    expect(notEnded.json<ErrorBody>().error.code).toBe('WEEK_NOT_ENDED');
    expect(notEnded.json<ErrorBody>().error.details).toEqual({
      endsAt: weekEndUtc(W36).toISOString(),
    });

    h.clock.set(new Date(weekEndUtc(W37).getTime() + 3_600_000)); // Monday after W37
    const outOfOrder = await post(W36, await admin(), { sync: true });
    expect(outOfOrder.statusCode).toBe(409);
    expect(outOfOrder.json<ErrorBody>().error.code).toBe('RECKONING_OUT_OF_ORDER');
    expect(outOfOrder.json<ErrorBody>().error.details).toEqual({ expectedWeekId: W35 });

    const dryNoSync = await post(W35, await admin(), { dryRun: true });
    expect(dryNoSync.statusCode).toBe(400);
    expect(dryNoSync.json<ErrorBody>().error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { field: 'dryRun' },
    });

    const badId = await post('2026-W99', await admin(), { sync: true });
    expect(badId.statusCode).toBe(400);
    expect(badId.json<ErrorBody>().error).toMatchObject({
      code: 'VALIDATION_FAILED',
      details: { field: 'weekId' },
    });
    const malformed = await post('2026-37', await admin(), { sync: true });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json<ErrorBody>().error.code).toBe('VALIDATION_FAILED');
  });

  it('previews with dryRun (zero rows written, no reckoning row) and runs synchronously', async () => {
    const headers = await admin();
    const before = await tableSnapshot(h.tdb);
    const preview = await post(W35, headers, { sync: true, dryRun: true });
    expect(preview.statusCode, preview.body).toBe(200);
    const previewBody = preview.json<ReckoningRunResult>();
    expect(previewBody.dryRun).toBe(true);
    expect(previewBody.flipsPreview.length).toBe(previewBody.flips);
    expect(previewBody.flips).toBe(
      fixture.cells.filter((c) => c.weeks[0]!.expected.flipped).length,
    );
    expect(previewBody.staleWalksSkipped).toBe(0);
    expect(await tableSnapshot(h.tdb)).toEqual(before);
    expect(h.boss.sent).toEqual([]);
    const noRow = await h.app.inject({ url: `/v1/admin/reckonings/${W35}`, headers });
    expect(noRow.statusCode).toBe(404);
    expect(noRow.json<ErrorBody>().error.code).toBe('RECKONING_NOT_FOUND');

    const run = await post(W35, headers, { sync: true });
    expect(run.statusCode, run.body).toBe(200);
    const body = run.json<ReckoningRunResult>();
    expect(body).toMatchObject({
      weekId: W35,
      dryRun: false,
      status: 'done',
      resumed: false,
      hexesProcessed: fixture.cells.length,
      flips: previewBody.flips,
      parentFlips: previewBody.parentFlips,
      walksAutofinished: 0,
      staleWalksSkipped: 0,
      flipsPreview: [],
    });
    expect(body.pushQueued).toBeGreaterThan(0);
    expect(body.leaderboardRows).toBeGreaterThan(0);
    expect(h.boss.sent.filter((s) => s.name === 'push.send')).toHaveLength(body.pushQueued);
    expect(Date.parse(body.finishedAt)).toBeGreaterThanOrEqual(Date.parse(body.startedAt));

    // a done week answers its stored result
    const again = await post(W35, headers, { sync: true });
    expect(again.statusCode).toBe(200);
    expect(again.json<ReckoningRunResult>()).toMatchObject({
      weekId: W35,
      resumed: false,
      hexesProcessed: fixture.cells.length,
      flips: body.flips,
    });

    const status = await h.app.inject({ url: `/v1/admin/reckonings/${W35}`, headers });
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json<ReckoningStatus>()).toMatchObject({
      weekId: W35,
      status: 'done',
      stage: 'done',
      attempt: 1,
      hexesProcessed: fixture.cells.length,
      flips: body.flips,
      batches: 1,
      pushQueued: body.pushQueued,
      error: null,
    });
    expect(status.json<ReckoningStatus>().finishedAt).toBe(body.finishedAt);
  });

  it('answers 409 RECKONING_RUNNING while another run holds the lock', async () => {
    const lock = await holdAdvisoryLock(h.tdb.pool);
    try {
      const res = await post(W36, await admin(), { sync: true });
      expect(res.statusCode).toBe(409);
      expect(res.json<ErrorBody>().error.code).toBe('RECKONING_RUNNING');
    } finally {
      await lock.release();
    }
  });

  it('enqueues the job with the singleton key when not synchronous', async () => {
    const headers = await admin();
    const res = await post(W36, headers);
    expect(res.statusCode, res.body).toBe(202);
    expect(res.json<ReckoningQueued>()).toEqual({
      weekId: W36,
      status: 'queued',
      jobId: expect.any(String) as string,
    });
    const sent = h.boss.sent.find((s) => s.name === 'reckoning.weekly');
    expect(sent).toEqual({
      name: 'reckoning.weekly',
      data: { weekId: W36 },
      options: { singletonKey: 'reckoning.weekly' },
    });
    // an empty body is accepted too
    const noBody = await h.app.inject({
      method: 'POST',
      url: `/v1/admin/reckonings/${W36}`,
      headers,
    });
    expect([202, 400]).toContain(noBody.statusCode);
  });

  it('answers 503 JOBS_DISABLED for an async run when jobs are disabled', async () => {
    const disabled = await createIntegrationHarness({
      now: '2026-09-14T09:00:00.000Z',
      app: { jobs: false },
    });
    try {
      const adminId = await seedUser(disabled.tdb, 'disabled-admin', 1, 'admin');
      const headers = await bearerFor(disabled, adminId, 'admin');
      const res = await disabled.app.inject({
        method: 'POST',
        url: `/v1/admin/reckonings/${W36}`,
        headers,
        payload: {},
      });
      expect(res.statusCode).toBe(503);
      expect(res.json<ErrorBody>().error.code).toBe('JOBS_DISABLED');
      // the synchronous path still works without pg-boss (pushes are skipped with a log line);
      // this database has no contributions, so the week that just ended is the one in sequence
      const sync = await disabled.app.inject({
        method: 'POST',
        url: `/v1/admin/reckonings/${W37}`,
        headers,
        payload: { sync: true },
      });
      expect(sync.statusCode, sync.body).toBe(200);
      expect(sync.json<ReckoningRunResult>().pushQueued).toBe(0);
    } finally {
      await disabled.close();
    }
  });
});
