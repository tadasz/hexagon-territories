import { expect, vi } from 'vitest';
import type { App } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';
import type { AuthResponse, TokenPair } from '../../src/modules/auth/schemas.js';
import { signAccessToken, type UserRole } from '../../src/modules/auth/tokens.js';
import type { Me } from '../../src/modules/me/schemas.js';
import type { JobBoss } from '../../src/plugins/jobs.js';
import type { AppleStub } from './apple.js';
import type { FakeClock } from './clock.js';

export interface SignInOptions {
  sub: string;
  email?: string;
  name?: string;
  /** Mint the identity token at the fake clock's time so a moved clock never expires it. */
  clock?: FakeClock;
}

export interface SignedInUser {
  userId: string;
  tokens: TokenPair;
  me: Me;
  isNewUser: boolean;
  restored: boolean;
}

/** Mints an identity token with the stub, posts it to `/v1/auth/apple` and returns the session. */
export async function signInTestUser(
  app: App,
  apple: AppleStub,
  opts: SignInOptions,
): Promise<SignedInUser> {
  const identityToken = await apple.mintIdentityToken({
    sub: opts.sub,
    ...(opts.email !== undefined ? { email: opts.email } : {}),
    ...(opts.clock ? { iat: opts.clock.now() } : {}),
  });
  const res = await app.inject({
    method: 'POST',
    url: '/v1/auth/apple',
    payload: {
      identityToken,
      ...(opts.name !== undefined ? { fullName: { givenName: opts.name } } : {}),
    },
  });
  expect(res.statusCode, res.body).toBe(200);
  const body = res.json<AuthResponse>();
  return {
    userId: body.me.id,
    tokens: body.tokens,
    me: body.me,
    isNewUser: body.isNewUser,
    restored: body.restored,
  };
}

/**
 * A fresh access token minted directly for `userId` at the harness clock's time. For suites that
 * move the clock by days (faction lock, export expiry): the sign-in flow is covered by
 * `auth.test.ts`, so these suites need not re-authenticate through it.
 */
export async function bearerFor(
  h: { config: AppConfig; clock: FakeClock },
  userId: string,
  role: UserRole = 'player',
): Promise<{ authorization: string }> {
  const { token } = await signAccessToken(
    { secret: h.config.jwt.secret, ttlS: h.config.jwt.accessTtlS, clock: h.clock },
    { id: userId, role },
  );
  return bearer(token);
}

export function bearer(tokens: TokenPair | string): { authorization: string } {
  return { authorization: `Bearer ${typeof tokens === 'string' ? tokens : tokens.accessToken}` };
}

export interface SentJob {
  name: string;
  data: unknown;
  options: Record<string, unknown> | undefined;
}

/** A pg-boss stand-in that records `send` calls and the attached workers. */
export function fakeBoss() {
  const handlers = new Map<string, (jobs: unknown[]) => Promise<unknown>>();
  const sent: SentJob[] = [];
  const boss = {
    start: vi.fn(() => Promise.resolve(boss)),
    stop: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    createQueue: vi.fn(() => Promise.resolve()),
    schedule: vi.fn(() => Promise.resolve()),
    work: vi.fn((name: string, ...rest: unknown[]) => {
      const handler = rest[rest.length - 1] as (jobs: unknown[]) => Promise<unknown>;
      handlers.set(name, handler);
      return Promise.resolve(`worker-${name}`);
    }),
    send: vi.fn((name: string, data: unknown, options?: Record<string, unknown>) => {
      sent.push({ name, data, options });
      return Promise.resolve(`job-${sent.length}`);
    }),
    handlers,
    sent,
  };
  return boss;
}

export type FakeBoss = ReturnType<typeof fakeBoss>;

export function asJobBoss(boss: FakeBoss): JobBoss {
  return boss as unknown as JobBoss;
}
