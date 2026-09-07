import { Value } from '@sinclair/typebox/value';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { accountExports, users } from '../../src/db/schema/index.js';
import { runAccountExport, type AccountExportDeps } from '../../src/jobs/account-export.js';
import { ExportBundleSchema, type ExportBundle } from '../../src/modules/me/export-sections.js';
import type { ExportStatus } from '../../src/modules/me/schemas.js';
import { bearer, bearerFor, signInTestUser, type SignedInUser } from '../helpers/auth.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';
import { parseMemoryUrl } from '../helpers/storage.js';

describeWithDb('GET /v1/me/export and account.export (SC-006)', () => {
  let h: IntegrationHarness;
  let user: SignedInUser;

  beforeAll(async () => {
    h = await createIntegrationHarness({ captureLogs: true });
    user = await signInTestUser(h.app, h.apple, {
      sub: 'export-user',
      email: 'export@privaterelay.appleid.com',
      name: 'Exporter',
      clock: h.clock,
    });
    await h.app.inject({
      method: 'POST',
      url: '/v1/me/faction',
      headers: bearer(user.tokens),
      payload: { factionId: 2 },
    });
  });
  afterAll(async () => {
    await h?.close();
  });

  const exportDeps = (): AccountExportDeps => ({
    db: h.tdb.db,
    storage: h.storage,
    clock: h.clock,
    log: h.app.log,
    exportTtlDays: h.config.account.exportTtlDays,
    refreshTtlDays: h.config.jwt.refreshTtlDays,
  });

  async function getExport(): Promise<{ status: number; body: ExportStatus }> {
    const res = await h.app.inject({
      url: '/v1/me/export',
      headers: await bearerFor(h, user.userId),
    });
    expect([200, 202]).toContain(res.statusCode);
    return { status: res.statusCode, body: res.json<ExportStatus>() };
  }

  it('enqueues a pending export on the first request and reuses it while pending', async () => {
    h.boss.sent.length = 0;
    const first = await getExport();
    expect(first.status).toBe(202);
    expect(first.body).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
      status: 'pending',
      requestedAt: h.clock.now().toISOString(),
      completedAt: null,
      expiresAt: null,
      downloadUrl: null,
      error: null,
    });
    expect(h.boss.sent).toEqual([
      {
        name: 'account.export',
        data: { exportId: first.body.id, userId: user.userId },
        options: { singletonKey: first.body.id, retryLimit: 3 },
      },
    ]);

    const second = await getExport();
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(h.boss.sent).toHaveLength(1);
  });

  it('builds the bundle in-process, marks it ready with a presigned URL and reuses it for 7 days', async () => {
    const pending = await getExport();
    h.clock.advanceSeconds(4);
    const result = await runAccountExport(exportDeps(), {
      exportId: pending.body.id,
      userId: user.userId,
    });
    expect(result).toEqual({
      exportId: pending.body.id,
      status: 'ready',
      objectKey: `exports/${user.userId}/${pending.body.id}.json`,
    });

    const ready = await getExport();
    expect(ready.status).toBe(200);
    expect(ready.body).toMatchObject({
      id: pending.body.id,
      status: 'ready',
      completedAt: h.clock.now().toISOString(),
      expiresAt: new Date(h.clock.now().getTime() + 7 * 86_400_000).toISOString(),
      error: null,
    });
    const url = parseMemoryUrl(ready.body.downloadUrl!);
    expect(url.key).toBe(result.objectKey);
    expect(url.exp).toBe(Math.floor(h.clock.now().getTime() / 1000) + 3600);

    // the bundle is valid JSON with every §4 field, e-mail included
    const raw = await h.storage.getObject(result.objectKey!);
    const bundle = JSON.parse(raw!.toString('utf8')) as ExportBundle;
    expect(
      Value.Check(ExportBundleSchema, bundle),
      JSON.stringify([...Value.Errors(ExportBundleSchema, bundle)]),
    ).toBe(true);
    expect(bundle.exportVersion).toBe(1);
    expect(bundle.account).toMatchObject({
      id: user.userId,
      appleUserId: 'export-user',
      email: 'export@privaterelay.appleid.com',
      displayName: 'Exporter',
      factionId: 2,
      factionChangedAt: null,
      xp: 0,
      level: 1,
      role: 'player',
      deletedAt: null,
    });
    expect(bundle.factions).toEqual([
      { id: 1, slug: 'owls', name: 'Owls' },
      { id: 2, slug: 'foxes', name: 'Foxes' },
      { id: 3, slug: 'deer', name: 'Deer' },
    ]);
    expect(bundle.sessions).toHaveLength(1);
    expect(bundle.sessions[0]).toMatchObject({ revokedAt: null });
    expect(raw!.toString('utf8')).not.toContain(user.tokens.refreshToken);

    // a running job for a ready export does nothing
    const skipped = await runAccountExport(exportDeps(), {
      exportId: pending.body.id,
      userId: user.userId,
    });
    expect(skipped.status).toBe('skipped');

    // the e-mail is in the bundle but never in the logs (FR-015)
    expect(h.logLines.join('\n')).not.toContain('export@privaterelay.appleid.com');

    // two days later the same bundle is returned with a fresh URL
    h.clock.advanceDays(2);
    const later = await getExport();
    expect(later.status).toBe(200);
    expect(later.body.id).toBe(pending.body.id);
    expect(parseMemoryUrl(later.body.downloadUrl!).exp).toBe(
      Math.floor(h.clock.now().getTime() / 1000) + 3600,
    );
  });

  it('builds a new bundle once the previous one expired', async () => {
    const before = await getExport();
    expect(before.body.status).toBe('ready');
    h.clock.advanceDays(6);
    const after = await getExport();
    expect(after.status).toBe(202);
    expect(after.body.status).toBe('pending');
    expect(after.body.id).not.toBe(before.body.id);
    expect(h.boss.sent.at(-1)?.data).toEqual({ exportId: after.body.id, userId: user.userId });
  });

  it('records a storage failure as failed without personal data, then retries with a new export', async () => {
    const pending = await getExport();
    expect(pending.body.status).toBe('pending');
    h.storage.failPut = new Error('bucket unreachable');
    try {
      // a non-final attempt leaves the row pending and rethrows so pg-boss retries
      await expect(
        runAccountExport(
          exportDeps(),
          { exportId: pending.body.id, userId: user.userId },
          { finalAttempt: false },
        ),
      ).rejects.toThrow('bucket unreachable');
      expect((await getExport()).body.status).toBe('pending');

      const final = await runAccountExport(
        exportDeps(),
        { exportId: pending.body.id, userId: user.userId },
        { finalAttempt: true },
      );
      expect(final.status).toBe('failed');
    } finally {
      h.storage.failPut = null;
    }

    const failed = await getExport();
    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({ id: pending.body.id, status: 'failed', downloadUrl: null });
    expect(failed.body.error).toBe('EXPORT_FAILED: Error');
    expect(failed.body.error).not.toContain('export@');

    h.clock.advanceMinutes(2);
    const retry = await getExport();
    expect(retry.status).toBe(202);
    expect(retry.body.id).not.toBe(pending.body.id);
    const ok = await runAccountExport(exportDeps(), {
      exportId: retry.body.id,
      userId: user.userId,
    });
    expect(ok.status).toBe('ready');
  });

  it('runs the export through the registered pg-boss worker with retry metadata', async () => {
    const [row] = await h.tdb.db
      .insert(accountExports)
      .values({ userId: user.userId, requestedAt: h.clock.now() })
      .returning({ id: accountExports.id });
    const handler = h.boss.handlers.get('account.export');
    await handler!([
      {
        id: 'job-x',
        name: 'account.export',
        data: { exportId: row!.id, userId: user.userId },
        retryCount: 0,
        retryLimit: 3,
      },
    ]);
    const [after] = await h.tdb.db
      .select()
      .from(accountExports)
      .where(eq(accountExports.id, row!.id));
    expect(after?.status).toBe('ready');
    expect(after?.objectKey).toBe(`exports/${user.userId}/${row!.id}.json`);
  });

  it('cascades export rows when the user row is deleted', async () => {
    const [count] = await h.tdb.db
      .select()
      .from(accountExports)
      .where(eq(accountExports.userId, user.userId));
    expect(count).toBeDefined();
    await h.tdb.db.delete(users).where(eq(users.id, user.userId));
    expect(
      await h.tdb.db.select().from(accountExports).where(eq(accountExports.userId, user.userId)),
    ).toHaveLength(0);
  });
});
