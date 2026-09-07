import { createHash, randomBytes } from 'node:crypto';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { SignJWT, errors as joseErrors, jwtVerify } from 'jose';
import type { Db } from '../../db/client.js';
import { refreshTokens, users } from '../../db/schema/index.js';
import { AppError, ERROR_CODES } from '../../errors.js';
import { addDays, addSeconds, systemClock, type Clock } from '../../lib/time.js';

export const JWT_ISSUER = 'nature-api';
export const JWT_AUDIENCE = 'nature-ios';
/** Expired or revoked refresh rows older than this are deleted on the user's next refresh. */
export const REFRESH_CLEANUP_DAYS = 7;

export type UserRole = 'player' | 'tester' | 'admin';

export interface AccessTokenOptions {
  secret: string;
  ttlS: number;
  clock?: Clock;
}

export interface AccessClaims {
  sub: string;
  role: UserRole;
  iat: number;
  exp: number;
}

export interface IssuedToken {
  token: string;
  expiresAt: Date;
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** HS256 access token with the claims of data-model.md §3 (`exp - iat = ttlS`). */
export async function signAccessToken(
  opts: AccessTokenOptions,
  user: { id: string; role: UserRole },
): Promise<IssuedToken> {
  const now = (opts.clock ?? systemClock).now();
  const iat = Math.floor(now.getTime() / 1_000);
  const exp = iat + opts.ttlS;
  const token = await new SignJWT({ role: user.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setSubject(user.id)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(secretKey(opts.secret));
  return { token, expiresAt: new Date(exp * 1_000) };
}

/** Throws `401 TOKEN_EXPIRED` for a stale token and `401 UNAUTHORIZED` for anything else invalid. */
export async function verifyAccessToken(
  opts: Pick<AccessTokenOptions, 'secret' | 'clock'>,
  token: string,
): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, secretKey(opts.secret), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: ['HS256'],
      ...(opts.clock ? { currentDate: opts.clock.now() } : {}),
    });
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number' ||
      !isRole(payload.role)
    ) {
      throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'Access token claims are invalid');
    }
    return { sub: payload.sub, role: payload.role, iat: payload.iat, exp: payload.exp };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (err instanceof joseErrors.JWTExpired) {
      throw new AppError(401, ERROR_CODES.TOKEN_EXPIRED, 'Access token has expired');
    }
    throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'Access token is invalid');
  }
}

function isRole(value: unknown): value is UserRole {
  return value === 'player' || value === 'tester' || value === 'admin';
}

/** `sha256(token)` as the `bytea` stored in `refresh_tokens.token_hash` (research.md R2). */
export function hashRefreshToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** 32 random bytes, base64url: the opaque string handed to the client. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface RefreshTokenOptions {
  ttlDays: number;
  clock?: Clock;
}

/** Drizzle handle or transaction: both expose the query builder. */
export type DbLike = Pick<Db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

/** Inserts a new refresh token for `userId` and returns the plaintext once. */
export async function issueRefreshToken(
  db: DbLike,
  userId: string,
  opts: RefreshTokenOptions,
): Promise<IssuedToken> {
  const now = (opts.clock ?? systemClock).now();
  const token = generateRefreshToken();
  const expiresAt = addDays(now, opts.ttlDays);
  await db.insert(refreshTokens).values({ userId, tokenHash: hashRefreshToken(token), expiresAt });
  return { token, expiresAt };
}

export interface RotatedRefresh {
  userId: string;
  role: UserRole;
  refresh: IssuedToken;
}

type RotationOutcome =
  { kind: 'reused'; userId: string } | { kind: 'rotated'; rotated: RotatedRefresh };

type LockedTokenRow = {
  id: string;
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  role: UserRole;
  deleted_at: Date | null;
};

/**
 * Rotates a refresh token inside one transaction (research.md R2; plan.md Shared Semantics 3–4):
 * the row is locked with `SELECT … FOR UPDATE`, so two racing refreshes serialise and the second
 * sees the first one's revocation. Unknown or expired → `401 INVALID_REFRESH_TOKEN`; the owner is
 * deleted → `401 ACCOUNT_DELETED`; already revoked → every refresh token of the user is revoked
 * and `401 REFRESH_REUSED`; otherwise the presented token is revoked, a successor is inserted and
 * rows older than `REFRESH_CLEANUP_DAYS` past expiry/revocation are deleted.
 */
export async function rotateRefreshToken(
  db: Db,
  token: string,
  opts: RefreshTokenOptions,
): Promise<RotatedRefresh> {
  const clock = opts.clock ?? systemClock;
  const now = clock.now();
  const hash = hashRefreshToken(token);

  // Reuse detection must commit the revocation before the request fails, so the transaction
  // returns an outcome and the 401 is thrown after the commit.
  const outcome = await db.transaction(async (tx): Promise<RotationOutcome> => {
    const locked = await tx.execute<LockedTokenRow>(sql`
      select rt.id, rt.user_id, rt.expires_at, rt.revoked_at, u.role, u.deleted_at
      from refresh_tokens rt
      join users u on u.id = rt.user_id
      where rt.token_hash = ${hash}
      for update of rt
    `);
    const row = locked.rows[0];
    if (!row) {
      throw new AppError(401, ERROR_CODES.INVALID_REFRESH_TOKEN, 'Refresh token is not valid');
    }
    if (row.deleted_at !== null) {
      throw new AppError(401, ERROR_CODES.ACCOUNT_DELETED, 'Account is scheduled for deletion');
    }
    if (new Date(row.expires_at).getTime() <= now.getTime()) {
      throw new AppError(401, ERROR_CODES.INVALID_REFRESH_TOKEN, 'Refresh token has expired');
    }
    if (row.revoked_at !== null) {
      await revokeAllForUser(tx, row.user_id, clock);
      return { kind: 'reused', userId: row.user_id };
    }

    await tx.update(refreshTokens).set({ revokedAt: now }).where(eq(refreshTokens.id, row.id));
    const refresh = await issueRefreshToken(tx, row.user_id, { ttlDays: opts.ttlDays, clock });
    await tx.update(users).set({ lastSeenAt: now }).where(eq(users.id, row.user_id));

    const cutoff = addDays(now, -REFRESH_CLEANUP_DAYS);
    await tx
      .delete(refreshTokens)
      .where(
        and(
          eq(refreshTokens.userId, row.user_id),
          or(lt(refreshTokens.expiresAt, cutoff), lt(refreshTokens.revokedAt, cutoff)),
        ),
      );

    return { kind: 'rotated', rotated: { userId: row.user_id, role: row.role, refresh } };
  });

  if (outcome.kind === 'reused') {
    throw new AppError(
      401,
      ERROR_CODES.REFRESH_REUSED,
      'Refresh token was already used; every session of this account has been revoked',
    );
  }
  return outcome.rotated;
}

/** Revokes the token if it exists and belongs to `userId`; returns whether a row was revoked. */
export async function revokeRefreshToken(
  db: DbLike,
  userId: string,
  token: string,
  clock: Clock = systemClock,
): Promise<boolean> {
  const rows = await db
    .update(refreshTokens)
    .set({ revokedAt: clock.now() })
    .where(
      and(
        eq(refreshTokens.tokenHash, hashRefreshToken(token)),
        eq(refreshTokens.userId, userId),
        isNull(refreshTokens.revokedAt),
      ),
    )
    .returning({ id: refreshTokens.id });
  return rows.length > 0;
}

/** Revokes every live refresh token of the user (reuse detection, account deletion). */
export async function revokeAllForUser(
  db: DbLike,
  userId: string,
  clock: Clock = systemClock,
): Promise<number> {
  const rows = await db
    .update(refreshTokens)
    .set({ revokedAt: clock.now() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
    .returning({ id: refreshTokens.id });
  return rows.length;
}

/** Seconds until `expiresAt` from `clock` (for `exp`-style fields). */
export function secondsUntil(expiresAt: Date, clock: Clock = systemClock): number {
  return Math.max(0, Math.floor((expiresAt.getTime() - clock.now().getTime()) / 1_000));
}

export { addSeconds };
