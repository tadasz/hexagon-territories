import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { refreshTokens, users } from '../../src/db/schema/index.js';
import { AppError } from '../../src/errors.js';
import {
  hashRefreshToken,
  issueRefreshToken,
  revokeAllForUser,
  revokeRefreshToken,
  rotateRefreshToken,
} from '../../src/modules/auth/tokens.js';
import { FakeClock } from '../helpers/clock.js';
import { createTestDatabase, describeWithDb, type TestDatabase } from '../helpers/db.js';
import { inject } from 'vitest';

describeWithDb('refresh token rotation (research.md R2)', () => {
  const adminUrl = inject('adminDatabaseUrl');
  let tdb: TestDatabase;
  let userId: string;
  const clock = new FakeClock('2026-09-07T10:00:00.000Z');
  const opts = { ttlDays: 60, clock };

  beforeAll(async () => {
    if (!adminUrl) throw new Error('adminDatabaseUrl was not provided by global setup');
    tdb = await createTestDatabase(adminUrl);
    const [user] = await tdb.db
      .insert(users)
      .values({ appleSub: 'tokens-user', displayName: 'Tokens' })
      .returning({ id: users.id });
    userId = user!.id;
  });
  afterAll(async () => {
    await tdb?.close();
  });

  async function liveTokens() {
    const rows = await tdb.db
      .select({ revokedAt: refreshTokens.revokedAt })
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, userId));
    return rows.filter((row) => row.revokedAt === null).length;
  }

  it('stores only the sha256 hash with a 60-day expiry', async () => {
    const issued = await issueRefreshToken(tdb.db, userId, opts);
    expect(issued.expiresAt.toISOString()).toBe('2026-11-06T10:00:00.000Z');
    const [row] = await tdb.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashRefreshToken(issued.token)));
    expect(row).toMatchObject({ userId, revokedAt: null });
    expect(row?.tokenHash.equals(hashRefreshToken(issued.token))).toBe(true);
    const raw = await tdb.pool.query<{ n: string }>(
      `select count(*) as n from refresh_tokens where encode(token_hash, 'escape') = $1`,
      [issued.token],
    );
    expect(raw.rows[0]?.n).toBe('0');
  });

  it('rotates: the old token is revoked, a successor issued, and reuse revokes every token', async () => {
    await tdb.db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
    const deviceA = await issueRefreshToken(tdb.db, userId, opts);
    const deviceB = await issueRefreshToken(tdb.db, userId, opts);
    expect(await liveTokens()).toBe(2);

    clock.advanceMinutes(5);
    const rotated = await rotateRefreshToken(tdb.db, deviceA.token, opts);
    expect(rotated.userId).toBe(userId);
    expect(rotated.role).toBe('player');
    expect(rotated.refresh.token).not.toBe(deviceA.token);
    expect(await liveTokens()).toBe(2); // successor of A + B
    const [user] = await tdb.db
      .select({ lastSeenAt: users.lastSeenAt })
      .from(users)
      .where(eq(users.id, userId));
    expect(user?.lastSeenAt?.toISOString()).toBe(clock.now().toISOString());

    // The successor works once.
    const again = await rotateRefreshToken(tdb.db, rotated.refresh.token, opts);
    expect(await liveTokens()).toBe(2);

    // Presenting the already-rotated token: theft → every session of the user is gone (SC-004).
    const reuse = await rotateRefreshToken(tdb.db, deviceA.token, opts).catch((e: unknown) => e);
    expect(reuse).toBeInstanceOf(AppError);
    expect((reuse as AppError).code).toBe('REFRESH_REUSED');
    expect(await liveTokens()).toBe(0);

    const afterReuse = await rotateRefreshToken(tdb.db, again.refresh.token, opts).catch(
      (e: unknown) => e,
    );
    expect((afterReuse as AppError).code).toBe('REFRESH_REUSED');
    const deviceBAfter = await rotateRefreshToken(tdb.db, deviceB.token, opts).catch(
      (e: unknown) => e,
    );
    expect((deviceBAfter as AppError).code).toBe('REFRESH_REUSED');
  });

  it('rejects unknown and expired tokens with INVALID_REFRESH_TOKEN', async () => {
    const unknown = await rotateRefreshToken(tdb.db, 'not-a-token', opts).catch((e: unknown) => e);
    expect((unknown as AppError).code).toBe('INVALID_REFRESH_TOKEN');

    const issued = await issueRefreshToken(tdb.db, userId, opts);
    clock.advanceDays(60);
    clock.advanceSeconds(1);
    const expired = await rotateRefreshToken(tdb.db, issued.token, opts).catch((e: unknown) => e);
    expect((expired as AppError).code).toBe('INVALID_REFRESH_TOKEN');
    expect((expired as AppError).message).toMatch(/expired/);
  });

  it('answers ACCOUNT_DELETED for a token of a deleted account', async () => {
    const issued = await issueRefreshToken(tdb.db, userId, opts);
    await tdb.db.update(users).set({ deletedAt: clock.now() }).where(eq(users.id, userId));
    const deleted = await rotateRefreshToken(tdb.db, issued.token, opts).catch((e: unknown) => e);
    expect((deleted as AppError).code).toBe('ACCOUNT_DELETED');
    await tdb.db.update(users).set({ deletedAt: null }).where(eq(users.id, userId));
  });

  it('revokes a single token for its owner only, and all tokens on demand', async () => {
    await tdb.db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
    const [other] = await tdb.db
      .insert(users)
      .values({ appleSub: 'tokens-other', displayName: 'Other' })
      .returning({ id: users.id });
    const mine = await issueRefreshToken(tdb.db, userId, opts);
    const theirs = await issueRefreshToken(tdb.db, other!.id, opts);

    expect(await revokeRefreshToken(tdb.db, userId, theirs.token, clock)).toBe(false);
    expect(await revokeRefreshToken(tdb.db, userId, mine.token, clock)).toBe(true);
    expect(await revokeRefreshToken(tdb.db, userId, mine.token, clock)).toBe(false);

    await issueRefreshToken(tdb.db, userId, opts);
    await issueRefreshToken(tdb.db, userId, opts);
    expect(await revokeAllForUser(tdb.db, userId, clock)).toBe(2);
    expect(await liveTokens()).toBe(0);
  });

  it('cleans up rows expired or revoked more than 7 days ago on the next refresh', async () => {
    await tdb.db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
    const stale = await issueRefreshToken(tdb.db, userId, { ttlDays: 1, clock });
    const revokedLongAgo = await issueRefreshToken(tdb.db, userId, opts);
    await revokeRefreshToken(tdb.db, userId, revokedLongAgo.token, clock);
    clock.advanceDays(9); // stale expired 8 days ago, revokedLongAgo revoked 9 days ago
    const recent = await issueRefreshToken(tdb.db, userId, opts);
    const before = await tdb.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, userId));
    expect(before).toHaveLength(3);

    await rotateRefreshToken(tdb.db, recent.token, opts);
    const after = await tdb.db.select().from(refreshTokens).where(eq(refreshTokens.userId, userId));
    // the rotated `recent` (revoked now) and its successor remain; the stale rows are gone
    expect(after).toHaveLength(2);
    expect(after.some((row) => row.tokenHash.equals(hashRefreshToken(stale.token)))).toBe(false);
    expect(after.some((row) => row.tokenHash.equals(hashRefreshToken(revokedLongAgo.token)))).toBe(
      false,
    );
  });
});
