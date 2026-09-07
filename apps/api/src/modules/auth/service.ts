import { createHash, randomInt } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../../config.js';
import type { Db } from '../../db/client.js';
import { users } from '../../db/schema/index.js';
import type { Clock } from '../../lib/time.js';
import { validateDisplayName } from '../me/display-name.js';
import { suggestedFactionId } from '../factions/service.js';
import { profileColumns, toMe } from '../me/service.js';
import type { AppleTokenVerifier } from './apple.js';
import type { AuthAppleRequest, AuthResponse, TokenPair } from './schemas.js';
import {
  issueRefreshToken,
  revokeAllForUser,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
  type UserRole,
} from './tokens.js';

export interface AuthServiceDeps {
  db: Db;
  clock: Clock;
  config: Pick<AppConfig, 'jwt'>;
  verifier: AppleTokenVerifier;
  log: FastifyBaseLogger;
}

/** First 8 hex characters of `sha256(sub)`: correlates log lines without exposing the identifier. */
export function subHash(sub: string): string {
  return createHash('sha256').update(sub, 'utf8').digest('hex').slice(0, 8);
}

/** `Explorer 0421` style: four zero-padded random digits (plan.md Shared Semantics 8). */
export function generateExplorerName(random: () => number = () => randomInt(0, 10_000)): string {
  return `Explorer ${String(random()).padStart(4, '0')}`;
}

/** Apple's given name when it passes the display-name rule, else a generated name. */
export function defaultDisplayName(givenName: string | undefined): string {
  if (givenName !== undefined) {
    const result = validateDisplayName(givenName);
    if (result.ok) return result.value;
  }
  return generateExplorerName();
}

export async function issueTokenPair(
  deps: Pick<AuthServiceDeps, 'db' | 'clock' | 'config'>,
  user: { id: string; role: UserRole },
): Promise<TokenPair> {
  const access = await signAccessToken(
    { secret: deps.config.jwt.secret, ttlS: deps.config.jwt.accessTtlS, clock: deps.clock },
    user,
  );
  const refresh = await issueRefreshToken(deps.db, user.id, {
    ttlDays: deps.config.jwt.refreshTtlDays,
    clock: deps.clock,
  });
  return {
    accessToken: access.token,
    accessExpiresAt: access.expiresAt.toISOString(),
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt.toISOString(),
  };
}

/**
 * POST /v1/auth/apple: verify the identity token, then create or resume the account keyed by
 * Apple's `sub`. E-mail and name are stored only on insert; a deleted account inside the grace
 * period is restored (plan.md Shared Semantics 1, 4, 8). Logs carry a hash of `sub`, never the
 * e-mail or the token (FR-015).
 */
export async function signInWithApple(
  deps: AuthServiceDeps,
  body: AuthAppleRequest,
): Promise<AuthResponse> {
  const identity = await deps.verifier.verify(body.identityToken);
  const now = deps.clock.now();
  const hash = subHash(identity.sub);

  const outcome = await deps.db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ ...profileColumns, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.appleSub, identity.sub))
      .limit(1)
      .for('update');

    if (!existing) {
      const [created] = await tx
        .insert(users)
        .values({
          appleSub: identity.sub,
          email: identity.email ?? null,
          displayName: defaultDisplayName(body.fullName?.givenName),
          lastSeenAt: now,
        })
        .returning(profileColumns);
      if (!created) throw new Error('insert returned no row');
      return { user: created, isNewUser: true, restored: false };
    }

    const restored = existing.deletedAt !== null;
    await tx
      .update(users)
      .set({ lastSeenAt: now, ...(restored ? { deletedAt: null } : {}) })
      .where(eq(users.id, existing.id));
    const { deletedAt: _deletedAt, ...profile } = existing;
    return { user: profile, isNewUser: false, restored };
  });

  const tokens = await issueTokenPair(deps, { id: outcome.user.id, role: outcome.user.role });
  const suggested = await suggestedFactionId(deps.db, deps.clock);
  deps.log.info(
    {
      userId: outcome.user.id,
      subHash: hash,
      isNewUser: outcome.isNewUser,
      restored: outcome.restored,
    },
    'auth: signed in with Apple',
  );
  return {
    tokens,
    me: toMe(outcome.user, suggested, now),
    isNewUser: outcome.isNewUser,
    restored: outcome.restored,
  };
}

/** POST /v1/auth/refresh: rotate, then mint a new access token for the owner. */
export async function refreshTokens(
  deps: Omit<AuthServiceDeps, 'verifier'>,
  refreshToken: string,
): Promise<TokenPair> {
  const rotated = await rotateRefreshToken(deps.db, refreshToken, {
    ttlDays: deps.config.jwt.refreshTtlDays,
    clock: deps.clock,
  });
  const access = await signAccessToken(
    { secret: deps.config.jwt.secret, ttlS: deps.config.jwt.accessTtlS, clock: deps.clock },
    { id: rotated.userId, role: rotated.role },
  );
  deps.log.info({ userId: rotated.userId }, 'auth: refreshed session');
  return {
    accessToken: access.token,
    accessExpiresAt: access.expiresAt.toISOString(),
    refreshToken: rotated.refresh.token,
    refreshExpiresAt: rotated.refresh.expiresAt.toISOString(),
  };
}

/** POST /v1/auth/logout: revokes the token when it belongs to the caller; always succeeds. */
export async function logout(
  deps: Pick<AuthServiceDeps, 'db' | 'clock' | 'log'>,
  userId: string,
  refreshToken: string,
): Promise<void> {
  const revoked = await revokeRefreshToken(deps.db, userId, refreshToken, deps.clock);
  deps.log.info({ userId, revoked }, 'auth: signed out');
}

export { revokeAllForUser };
