import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../../src/app.js';
import { signAccessToken } from '../../src/modules/auth/tokens.js';
import type { AuthUserRecord, AuthUserSource } from '../../src/plugins/auth.js';
import { TEST_JWT_SECRET, buildUnitApp } from '../helpers/app.js';
import { FakeClock } from '../helpers/clock.js';

const USER_ID = '5b3f4e6c-2d1a-4c8b-9e7f-0a1b2c3d4e5f';

function fakeUsers(record: AuthUserRecord | null) {
  const state = { record };
  return {
    findById: vi.fn((id: string) =>
      Promise.resolve(state.record && state.record.id === id ? { ...state.record } : null),
    ),
    touchLastSeen: vi.fn((_id: string, at: Date) => {
      if (state.record) state.record.lastSeenAt = at;
      return Promise.resolve();
    }),
  } satisfies AuthUserSource;
}

describe('auth plugin (stubbed user source)', () => {
  let app: App | undefined;
  const clock = new FakeClock('2026-09-07T10:00:00.000Z');
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function build(users: AuthUserSource) {
    const built = await buildUnitApp({ authUsers: users, clock });
    built.get('/protected', { preHandler: [built.authenticate] }, (request) => ({
      user: request.user,
    }));
    return built;
  }

  function token(ttlS = 900) {
    return signAccessToken(
      { secret: TEST_JWT_SECRET, ttlS, clock },
      { id: USER_ID, role: 'player' },
    );
  }

  it('answers 401 UNAUTHORIZED without a bearer header', async () => {
    app = await build(fakeUsers(null));
    const res = await app.inject({ url: '/protected' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
    const basic = await app.inject({ url: '/protected', headers: { authorization: 'Basic abc' } });
    expect(basic.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('answers 401 UNAUTHORIZED for a bad token and for an unknown user', async () => {
    app = await build(fakeUsers(null));
    const bad = await app.inject({ url: '/protected', headers: { authorization: 'Bearer nope' } });
    expect(bad.json()).toMatchObject({ error: { code: 'UNAUTHORIZED' } });

    const { token: valid } = await token();
    const unknown = await app.inject({
      url: '/protected',
      headers: { authorization: `Bearer ${valid}` },
    });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json()).toMatchObject({
      error: { code: 'UNAUTHORIZED', message: 'Unknown account' },
    });
  });

  it('answers 401 TOKEN_EXPIRED for an expired token', async () => {
    app = await build(fakeUsers(null));
    const { token: stale } = await token(60);
    clock.advanceSeconds(61);
    const res = await app.inject({
      url: '/protected',
      headers: { authorization: `Bearer ${stale}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'TOKEN_EXPIRED' } });
  });

  it('answers 401 ACCOUNT_DELETED for a deleted account', async () => {
    app = await build(
      fakeUsers({
        id: USER_ID,
        role: 'player',
        factionId: 1,
        lastSeenAt: clock.now(),
        deletedAt: clock.now(),
      }),
    );
    const { token: valid } = await token();
    const res = await app.inject({
      url: '/protected',
      headers: { authorization: `Bearer ${valid}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'ACCOUNT_DELETED' } });
  });

  it('fills request.user and writes last_seen_at at most once per 15 minutes', async () => {
    const users = fakeUsers({
      id: USER_ID,
      role: 'tester',
      factionId: 2,
      lastSeenAt: null,
      deletedAt: null,
    });
    app = await build(users);
    const { token: valid } = await token(3600);
    const headers = { authorization: `Bearer ${valid}` };

    const first = await app.inject({ url: '/protected', headers });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({
      user: { id: USER_ID, role: 'tester', factionId: 2, lastSeenAt: clock.now().toISOString() },
    });
    expect(users.touchLastSeen).toHaveBeenCalledTimes(1);

    clock.advanceMinutes(14);
    await app.inject({ url: '/protected', headers });
    expect(users.touchLastSeen).toHaveBeenCalledTimes(1);

    clock.advanceMinutes(1);
    const later = await app.inject({ url: '/protected', headers });
    expect(users.touchLastSeen).toHaveBeenCalledTimes(2);
    expect(users.touchLastSeen).toHaveBeenLastCalledWith(USER_ID, clock.now());
    expect(later.json()).toMatchObject({ user: { lastSeenAt: clock.now().toISOString() } });
  });

  it('never fails the request when the last_seen_at write fails', async () => {
    const users = fakeUsers({
      id: USER_ID,
      role: 'player',
      factionId: null,
      lastSeenAt: null,
      deletedAt: null,
    });
    users.touchLastSeen.mockRejectedValueOnce(new Error('db hiccup'));
    app = await build(users);
    const { token: valid } = await token();
    const res = await app.inject({
      url: '/protected',
      headers: { authorization: `Bearer ${valid}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
