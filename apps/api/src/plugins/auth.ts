import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Db } from '../db/client.js';
import { users } from '../db/schema/index.js';
import { AppError, ERROR_CODES } from '../errors.js';
import { MS_PER_MINUTE, systemClock, type Clock } from '../lib/time.js';
import { verifyAccessToken, type UserRole } from '../modules/auth/tokens.js';

/** What `request.user` carries after `fastify.authenticate` (research.md R3). */
export interface AuthUser {
  id: string;
  role: UserRole;
  factionId: number | null;
  lastSeenAt: Date | null;
}

export interface AuthUserRecord extends AuthUser {
  deletedAt: Date | null;
}

/** The two queries the plugin needs; unit tests inject a fake, production uses Drizzle. */
export interface AuthUserSource {
  findById(id: string): Promise<AuthUserRecord | null>;
  touchLastSeen(id: string, at: Date): Promise<void>;
}

export function drizzleAuthUserSource(db: Db): AuthUserSource {
  return {
    async findById(id) {
      const [row] = await db
        .select({
          id: users.id,
          role: users.role,
          factionId: users.factionId,
          lastSeenAt: users.lastSeenAt,
          deletedAt: users.deletedAt,
        })
        .from(users)
        .where(eq(users.id, id))
        .limit(1);
      return row ?? null;
    },
    async touchLastSeen(id, at) {
      await db.update(users).set({ lastSeenAt: at }).where(eq(users.id, id));
    },
  };
}

export interface AuthPluginOptions {
  jwtSecret: string;
  clock?: Clock;
  /** `last_seen_at` is rewritten at most once per this interval (default 15 minutes). */
  lastSeenThrottleMs?: number;
  /** Defaults to `drizzleAuthUserSource(fastify.db)`. */
  users?: AuthUserSource;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** `preHandler` that requires a valid access token and fills `request.user`. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    /** The signed-in player, set by `fastify.authenticate`; null on public routes. */
    user: AuthUser | null;
  }
}

export const LAST_SEEN_THROTTLE_MS = 15 * MS_PER_MINUTE;

/**
 * Bearer authentication for `/v1/me*` and `/v1/auth/logout` (research.md R3): verifies the HS256
 * access token, loads the user by primary key so deletion is enforced immediately
 * (`401 ACCOUNT_DELETED`), and refreshes `users.last_seen_at` at most every 15 minutes without
 * ever failing the request on that write.
 */
export const authPlugin = fp<AuthPluginOptions>(
  (fastify, opts, done) => {
    const clock = opts.clock ?? systemClock;
    const throttleMs = opts.lastSeenThrottleMs ?? LAST_SEEN_THROTTLE_MS;
    let source = opts.users;
    if (!source) {
      if (!fastify.hasDecorator('db')) {
        done(new Error('auth plugin needs the db plugin or an injected user source'));
        return;
      }
      source = drizzleAuthUserSource(fastify.db);
    }
    const users = source;

    fastify.decorateRequest('user', null);

    fastify.decorate('authenticate', async (request: FastifyRequest) => {
      const header = request.headers.authorization;
      if (typeof header !== 'string' || !/^Bearer\s+\S+$/i.test(header)) {
        throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'Missing bearer token');
      }
      const token = header.slice(header.indexOf(' ') + 1).trim();
      const claims = await verifyAccessToken({ secret: opts.jwtSecret, clock }, token);

      const user = await users.findById(claims.sub);
      if (!user) throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'Unknown account');
      if (user.deletedAt !== null) {
        throw new AppError(401, ERROR_CODES.ACCOUNT_DELETED, 'Account is scheduled for deletion');
      }

      const now = clock.now();
      const stale =
        user.lastSeenAt === null || now.getTime() - user.lastSeenAt.getTime() >= throttleMs;
      if (stale) {
        users.touchLastSeen(user.id, now).catch((err: unknown) => {
          request.log.warn({ err, userId: user.id }, 'auth: last_seen_at update failed');
        });
      }

      request.user = {
        id: user.id,
        role: user.role,
        factionId: user.factionId,
        lastSeenAt: stale ? now : user.lastSeenAt,
      };
    });
    done();
  },
  { name: 'auth', fastify: '5.x' },
);
