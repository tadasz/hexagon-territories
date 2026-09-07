import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { refreshTokens, users } from '../../src/db/schema/index.js';
import type { AuthResponse, TokenPair } from '../../src/modules/auth/schemas.js';
import { bearer, signInTestUser } from '../helpers/auth.js';
import { describeWithDb } from '../helpers/db.js';
import { createIntegrationHarness, type IntegrationHarness } from '../helpers/integration.js';

describeWithDb('POST /v1/auth/* against a real database', () => {
  let h: IntegrationHarness;

  beforeAll(async () => {
    h = await createIntegrationHarness({ captureLogs: true });
  });
  afterAll(async () => {
    await h?.close();
  });

  function signIn(payload: Record<string, unknown>) {
    return h.app.inject({ method: 'POST', url: '/v1/auth/apple', payload });
  }

  it('creates an account from the first sign-in with the given name as display name', async () => {
    const identityToken = await h.apple.mintIdentityToken({
      sub: 'apple-sub-tadas',
      email: 'tadas@privaterelay.appleid.com',
      iat: h.clock.now(),
    });
    const res = await signIn({
      identityToken,
      authorizationCode: 'c_abc',
      fullName: { givenName: '  Tadas ', familyName: 'Žiemys' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json<AuthResponse>();
    expect(body.isNewUser).toBe(true);
    expect(body.restored).toBe(false);
    expect(body.me).toMatchObject({
      displayName: 'Tadas',
      factionId: null,
      factionChangedAt: null,
      factionChangeAvailableAt: null,
      xp: 0,
      level: 1,
      role: 'player',
      suggestedFactionId: 1,
    });
    expect(body.me).not.toHaveProperty('email');
    expect(body.tokens.accessToken.split('.')).toHaveLength(3);
    expect(body.tokens.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.tokens.accessExpiresAt).toBe('2026-09-07T10:15:00.000Z');
    expect(body.tokens.refreshExpiresAt).toBe('2026-11-06T10:00:00.000Z');

    const [row] = await h.tdb.db.select().from(users).where(eq(users.appleSub, 'apple-sub-tadas'));
    expect(row).toMatchObject({
      email: 'tadas@privaterelay.appleid.com',
      displayName: 'Tadas',
      lastSeenAt: h.clock.now(),
    });
  });

  it('generates "Explorer NNNN" when Apple supplies no usable name', async () => {
    const noName = await signInTestUser(h.app, h.apple, { sub: 'apple-sub-anon', clock: h.clock });
    expect(noName.me.displayName).toMatch(/^Explorer \d{4}$/);
    const tooShort = await signInTestUser(h.app, h.apple, {
      sub: 'apple-sub-short',
      name: 'A',
      clock: h.clock,
    });
    expect(tooShort.me.displayName).toMatch(/^Explorer \d{4}$/);
  });

  it('returns the same account on later sign-ins without overwriting e-mail or name', async () => {
    const first = await signInTestUser(h.app, h.apple, {
      sub: 'apple-sub-returning',
      email: 'first@example.com',
      name: 'First',
      clock: h.clock,
    });
    await h.tdb.db
      .update(users)
      .set({ factionId: 2, xp: 120, level: 2 })
      .where(eq(users.id, first.userId));

    const identityToken = await h.apple.mintIdentityToken({
      sub: 'apple-sub-returning',
      email: 'changed@example.com',
      iat: h.clock.now(),
    });
    const res = await signIn({ identityToken, fullName: { givenName: 'Changed' } });
    const body = res.json<AuthResponse>();
    expect(body.isNewUser).toBe(false);
    expect(body.me).toMatchObject({
      id: first.userId,
      displayName: 'First',
      factionId: 2,
      xp: 120,
      level: 2,
    });

    const bare = await signInTestUser(h.app, h.apple, {
      sub: 'apple-sub-returning',
      clock: h.clock,
    });
    expect(bare.userId).toBe(first.userId);
    expect(bare.me.displayName).toBe('First');
    const [row] = await h.tdb.db.select().from(users).where(eq(users.id, first.userId));
    expect(row?.email).toBe('first@example.com');
  });

  it('refuses identity tokens for another app, expired or forged (SC-004)', async () => {
    const wrongAud = await h.apple.mintIdentityToken({
      sub: 'x',
      aud: 'com.other.app',
      iat: h.clock.now(),
    });
    const audRes = await signIn({ identityToken: wrongAud });
    expect(audRes.statusCode).toBe(401);
    expect(audRes.json()).toMatchObject({
      error: { code: 'INVALID_APPLE_TOKEN', details: { reason: 'audience' } },
    });

    const expired = await h.apple.mintIdentityToken({
      sub: 'x',
      iat: new Date(h.clock.now().getTime() - 7_200_000),
      exp: 60,
    });
    expect((await signIn({ identityToken: expired })).json()).toMatchObject({
      error: { details: { reason: 'expired' } },
    });

    const [parts0, parts1] = wrongAud.split('.');
    const forged = `${parts0}.${parts1}.AAAA`;
    expect((await signIn({ identityToken: forged })).statusCode).toBe(401);
    const created = await h.tdb.db.select().from(users).where(eq(users.appleSub, 'x'));
    expect(created).toHaveLength(0);

    const invalidBody = await signIn({ identityToken: '' });
    expect(invalidBody.statusCode).toBe(400);
    expect(invalidBody.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('restores an account deleted inside the grace period', async () => {
    const user = await signInTestUser(h.app, h.apple, {
      sub: 'apple-sub-deleted',
      name: 'Gone',
      clock: h.clock,
    });
    await h.tdb.db
      .update(users)
      .set({ deletedAt: h.clock.now(), factionId: 3 })
      .where(eq(users.id, user.userId));

    const back = await signInTestUser(h.app, h.apple, { sub: 'apple-sub-deleted', clock: h.clock });
    expect(back.userId).toBe(user.userId);
    expect(back.restored).toBe(true);
    expect(back.isNewUser).toBe(false);
    expect(back.me).toMatchObject({ displayName: 'Gone', factionId: 3 });
    const [row] = await h.tdb.db.select().from(users).where(eq(users.id, user.userId));
    expect(row?.deletedAt).toBeNull();
  });

  it('refreshes silently, detects reuse and revokes every session', async () => {
    const user = await signInTestUser(h.app, h.apple, { sub: 'apple-sub-refresh', clock: h.clock });
    const second = await signInTestUser(h.app, h.apple, {
      sub: 'apple-sub-refresh',
      clock: h.clock,
    });
    h.clock.advanceMinutes(16);

    const refresh = (refreshToken: string) =>
      h.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken } });

    const rotated = await refresh(user.tokens.refreshToken);
    expect(rotated.statusCode, rotated.body).toBe(200);
    const pair = rotated.json<TokenPair>();
    expect(pair.refreshToken).not.toBe(user.tokens.refreshToken);
    expect(pair.accessExpiresAt).toBe(new Date(h.clock.now().getTime() + 900_000).toISOString());

    // the old access token expired after 15 min; the new one works
    const stale = await h.app.inject({ url: '/v1/me', headers: bearer(user.tokens) });
    expect(stale.json()).toMatchObject({ error: { code: 'TOKEN_EXPIRED' } });
    const fresh = await h.app.inject({ url: '/v1/me', headers: bearer(pair.accessToken) });
    expect(fresh.statusCode).toBe(200);

    const reused = await refresh(user.tokens.refreshToken);
    expect(reused.statusCode).toBe(401);
    expect(reused.json()).toMatchObject({ error: { code: 'REFRESH_REUSED' } });

    // every session of the account is gone: the successor and the second device
    expect((await refresh(pair.refreshToken)).json()).toMatchObject({
      error: { code: 'REFRESH_REUSED' },
    });
    expect((await refresh(second.tokens.refreshToken)).json()).toMatchObject({
      error: { code: 'REFRESH_REUSED' },
    });
    const live = await h.tdb.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, user.userId));
    expect(live.filter((row) => row.revokedAt === null)).toHaveLength(0);

    expect((await refresh('unknown-token')).json()).toMatchObject({
      error: { code: 'INVALID_REFRESH_TOKEN' },
    });
  });

  it('logs out the presented refresh token only', async () => {
    const phone = await signInTestUser(h.app, h.apple, { sub: 'apple-sub-logout', clock: h.clock });
    const tablet = await signInTestUser(h.app, h.apple, {
      sub: 'apple-sub-logout',
      clock: h.clock,
    });

    const noAuth = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      payload: { refreshToken: phone.tokens.refreshToken },
    });
    expect(noAuth.statusCode).toBe(401);

    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: bearer(phone.tokens),
      payload: { refreshToken: phone.tokens.refreshToken },
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');

    // idempotent and tolerant of unknown tokens
    const again = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: bearer(phone.tokens),
      payload: { refreshToken: 'unknown' },
    });
    expect(again.statusCode).toBe(204);

    // the other device is unaffected
    const tabletRefresh = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: tablet.tokens.refreshToken },
    });
    expect(tabletRefresh.statusCode, 'the other device is unaffected').toBe(200);

    // the logged-out token can never be used again; presenting a revoked token counts as reuse
    // (research.md R2), which is why the client clears it from the Keychain on sign-out
    const phoneRefresh = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: phone.tokens.refreshToken },
    });
    expect(phoneRefresh.statusCode).toBe(401);
    expect(phoneRefresh.json()).toMatchObject({ error: { code: 'REFRESH_REUSED' } });
  });

  it('never logs e-mail addresses, identity tokens or credentials (FR-015)', async () => {
    const identityToken = await h.apple.mintIdentityToken({
      sub: 'apple-sub-logging',
      email: 'private-relay-9f3a@privaterelay.appleid.com',
      iat: h.clock.now(),
    });
    const res = await signIn({ identityToken, fullName: { givenName: 'Logged' } });
    const body = res.json<AuthResponse>();
    const joined = h.logLines.join('\n');
    expect(joined).toContain('auth: signed in with Apple');
    expect(joined).not.toContain('privaterelay.appleid.com');
    expect(joined).not.toContain('private-relay-9f3a');
    expect(joined).not.toContain(identityToken);
    expect(joined).not.toContain(body.tokens.accessToken);
    expect(joined).not.toContain(body.tokens.refreshToken);
    expect(joined).not.toContain('apple-sub-logging');
  });

  it('throttles the auth routes per client address (FR-005)', async () => {
    const limited = await buildApp({
      config: { ...h.config, rateLimit: { authPerMin: 3 } },
      logger: false,
      pool: h.tdb.pool,
      jobs: false,
      storage: h.storage,
      clock: h.clock,
    });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const res = await limited.inject({
          method: 'POST',
          url: '/v1/auth/refresh',
          payload: { refreshToken: 'x' },
        });
        codes.push(res.statusCode);
        if (res.statusCode === 429) {
          expect(res.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
          expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
        }
      }
      expect(codes).toEqual([401, 401, 401, 429, 429]);
      // /v1/auth/apple shares the per-route counters only with itself; it still has budget
      const apple = await limited.inject({
        method: 'POST',
        url: '/v1/auth/apple',
        payload: { identityToken: 'x' },
      });
      expect(apple.statusCode).toBe(401);
    } finally {
      await limited.close();
    }
  });
});
