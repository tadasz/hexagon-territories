import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { accountExports, refreshTokens, users } from '../../src/db/schema/index.js';
import { runAccountPurge, type AccountPurgeDeps } from '../../src/jobs/account-purge.js';
import { PURGE_STEPS, purgeCoveredTables } from '../../src/modules/me/purge.js';
import type { AccountDeletion } from '../../src/modules/me/schemas.js';
import { bearer, signInTestUser } from '../helpers/auth.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';

interface ForeignKey {
  table_name: string;
  constraint_name: string;
  delete_rule: string;
}

describeWithDb('DELETE /v1/me and account.purge (SC-005)', () => {
  let h: IntegrationHarness;

  beforeAll(async () => {
    h = await createIntegrationHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  const purgeDeps = (): AccountPurgeDeps => ({
    db: h.tdb.db,
    storage: h.storage,
    clock: h.clock,
    log: h.app.log,
    graceDays: h.config.account.purgeGraceDays,
  });

  it('covers every foreign key that references users (FR-010)', async () => {
    const { rows } = await h.tdb.pool.query<ForeignKey>(`
      select tc.table_name, tc.constraint_name, rc.delete_rule
      from information_schema.table_constraints tc
      join information_schema.referential_constraints rc on rc.constraint_name = tc.constraint_name
      join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
      where tc.constraint_type = 'FOREIGN KEY' and ccu.table_name = 'users' and ccu.column_name = 'id'
      order by tc.table_name
    `);
    expect(rows.length).toBeGreaterThan(5);
    const covered = purgeCoveredTables(PURGE_STEPS);
    const report = rows.map((fk) => {
      const how =
        fk.delete_rule === 'CASCADE' || fk.delete_rule === 'SET NULL'
          ? `on delete ${fk.delete_rule.toLowerCase()}`
          : covered.has(fk.table_name)
            ? 'purge step'
            : 'UNCOVERED';
      return { table: fk.table_name, constraint: fk.constraint_name, how };
    });
    console.table(report);
    const uncovered = report.filter((row) => row.how === 'UNCOVERED').map((row) => row.table);
    expect(
      uncovered,
      `tables referencing users without ON DELETE CASCADE/SET NULL or a purge step: ${uncovered.join(', ')}`,
    ).toEqual([]);
  });

  it('marks the account deleted, revokes every session and schedules the purge', async () => {
    const phone = await signInTestUser(h.app, h.apple, {
      sub: 'delete-me',
      name: 'Delete',
      clock: h.clock,
    });
    const tablet = await signInTestUser(h.app, h.apple, { sub: 'delete-me', clock: h.clock });
    h.boss.sent.length = 0;

    const res = await h.app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: bearer(phone.tokens),
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<AccountDeletion>();
    expect(body.deletedAt).toBe(h.clock.now().toISOString());
    expect(body.purgeAt).toBe('2026-10-07T10:00:00.000Z');

    expect(h.boss.sent).toEqual([
      {
        name: 'account.purge',
        data: { userId: phone.userId, deletedAt: body.deletedAt },
        options: {
          startAfter: new Date(body.purgeAt),
          singletonKey: phone.userId,
          retryLimit: 5,
          retryBackoff: true,
        },
      },
    ]);

    // old credentials are refused everywhere (Shared Semantics 4)
    const me = await h.app.inject({ url: '/v1/me', headers: bearer(phone.tokens) });
    expect(me.statusCode).toBe(401);
    expect(me.json()).toMatchObject({ error: { code: 'ACCOUNT_DELETED' } });
    const other = await h.app.inject({ url: '/v1/me', headers: bearer(tablet.tokens) });
    expect(other.json()).toMatchObject({ error: { code: 'ACCOUNT_DELETED' } });
    const refresh = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: tablet.tokens.refreshToken },
    });
    expect(refresh.statusCode).toBe(401);
    expect(refresh.json()).toMatchObject({ error: { code: 'ACCOUNT_DELETED' } });

    const tokens = await h.tdb.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, phone.userId));
    expect(tokens.every((row) => row.revokedAt !== null)).toBe(true);
    const second = await h.app.inject({
      method: 'DELETE',
      url: '/v1/me',
      headers: bearer(phone.tokens),
    });
    expect(second.statusCode).toBe(401);
  });

  it('does not purge before the grace period, nor a restored account', async () => {
    const user = await signInTestUser(h.app, h.apple, { sub: 'purge-early', clock: h.clock });
    await h.app.inject({ method: 'DELETE', url: '/v1/me', headers: bearer(user.tokens) });

    h.clock.advanceDays(29);
    const early = await runAccountPurge(purgeDeps(), { userId: user.userId, deletedAt: '' });
    expect(early).toEqual({
      userId: user.userId,
      purged: false,
      reason: 'grace_period',
      steps: [],
    });

    const restored = await signInTestUser(h.app, h.apple, { sub: 'purge-early', clock: h.clock });
    expect(restored.restored).toBe(true);
    h.clock.advanceDays(5);
    const afterRestore = await runAccountPurge(purgeDeps(), { userId: user.userId, deletedAt: '' });
    expect(afterRestore).toMatchObject({ purged: false, reason: 'restored' });
    expect(await h.tdb.db.select().from(users).where(eq(users.id, user.userId))).toHaveLength(1);
  });

  it('erases the account and every row keyed to it after 30 days, idempotently', async () => {
    const user = await signInTestUser(h.app, h.apple, {
      sub: 'purge-me',
      name: 'Purge',
      clock: h.clock,
    });
    await h.app.inject({ url: '/v1/me/export', headers: bearer(user.tokens) });
    const [exportRow] = await h.tdb.db
      .select()
      .from(accountExports)
      .where(eq(accountExports.userId, user.userId));
    const objectKey = `exports/${user.userId}/${exportRow!.id}.json`;
    await h.storage.putObject(objectKey, '{}', 'application/json');
    await h.tdb.db
      .update(accountExports)
      .set({ status: 'ready', objectKey })
      .where(eq(accountExports.id, exportRow!.id));
    await h.tdb.db.update(users).set({ factionId: 2 }).where(eq(users.id, user.userId));

    await h.app.inject({ method: 'DELETE', url: '/v1/me', headers: bearer(user.tokens) });
    h.clock.advanceDays(30);

    const result = await runAccountPurge(purgeDeps(), { userId: user.userId, deletedAt: '' });
    expect(result.purged).toBe(true);
    expect(result.steps.map((step) => step.name)).toEqual(PURGE_STEPS.map((step) => step.name));
    const rows = Object.fromEntries(result.steps.map((step) => [step.name, step.rows]));
    expect(rows.exports).toBe(1);
    expect(rows.refresh_tokens).toBeGreaterThanOrEqual(1);
    expect(rows.users).toBe(1);

    expect(await h.tdb.db.select().from(users).where(eq(users.id, user.userId))).toHaveLength(0);
    expect(
      await h.tdb.db.select().from(refreshTokens).where(eq(refreshTokens.userId, user.userId)),
    ).toHaveLength(0);
    expect(
      await h.tdb.db.select().from(accountExports).where(eq(accountExports.userId, user.userId)),
    ).toHaveLength(0);
    expect(await h.storage.getObject(objectKey)).toBeNull();

    const again = await runAccountPurge(purgeDeps(), { userId: user.userId, deletedAt: '' });
    expect(again).toEqual({ userId: user.userId, purged: false, reason: 'not_found', steps: [] });

    // the same Apple ID now gets a brand-new account
    const fresh = await signInTestUser(h.app, h.apple, { sub: 'purge-me', clock: h.clock });
    expect(fresh.isNewUser).toBe(true);
    expect(fresh.userId).not.toBe(user.userId);
    expect(fresh.me.displayName).toMatch(/^Explorer \d{4}$/);
    expect(fresh.me.factionId).toBeNull();
  });

  it('runs the purge through the registered pg-boss worker', async () => {
    const user = await signInTestUser(h.app, h.apple, { sub: 'purge-worker', clock: h.clock });
    await h.app.inject({ method: 'DELETE', url: '/v1/me', headers: bearer(user.tokens) });
    h.clock.advanceDays(31);
    const handler = h.boss.handlers.get('account.purge');
    expect(handler).toBeDefined();
    await handler!([
      { id: 'job-1', name: 'account.purge', data: { userId: user.userId, deletedAt: '' } },
    ]);
    expect(await h.tdb.db.select().from(users).where(eq(users.id, user.userId))).toHaveLength(0);
  });
});
