import { afterEach, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { authRateLimit } from '../../src/plugins/rate-limit.js';
import { buildUnitApp, testConfig } from '../helpers/app.js';

describe('rate limit plugin', () => {
  let app: App | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('answers the 21st call in a minute with the 429 envelope and retry-after', async () => {
    const config = testConfig();
    app = await buildUnitApp({ config });
    app.post('/limited', { config: authRateLimit(20) }, () => ({ ok: true }));
    app.post('/free', () => ({ ok: true }));

    for (let i = 1; i <= 20; i += 1) {
      const res = await app.inject({ method: 'POST', url: '/limited' });
      expect(res.statusCode, `call ${i}`).toBe(200);
      expect(res.headers['x-ratelimit-limit']).toBe('20');
      expect(res.headers['x-ratelimit-remaining']).toBe(String(20 - i));
    }

    const blocked = await app.inject({ method: 'POST', url: '/limited' });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['content-type']).toMatch(/application\/json/);
    const body = blocked.json<{
      error: { code: string; message: string; details: { retryAfterS: number; max: number } };
      requestId: string;
    }>();
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.details.max).toBe(20);
    expect(body.error.details.retryAfterS).toBeGreaterThanOrEqual(1);
    expect(body.error.details.retryAfterS).toBeLessThanOrEqual(60);
    expect(Number(blocked.headers['retry-after'])).toBe(body.error.details.retryAfterS);
    expect(typeof body.requestId).toBe('string');

    // Routes without `config.rateLimit` are never throttled (global: false).
    const free = await app.inject({ method: 'POST', url: '/free' });
    expect(free.statusCode).toBe(200);
    expect(free.headers['x-ratelimit-limit']).toBeUndefined();
  });

  it('applies the configured limit to the auth routes', async () => {
    app = await buildUnitApp({
      config: testConfig({ rateLimit: { authPerMin: 2 } }),
    });
    const call = () =>
      app!.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken: 'x' } });
    // The first two reach the handler (the database is unreachable here, so they end as 500).
    expect((await call()).statusCode).not.toBe(429);
    expect((await call()).statusCode).not.toBe(429);
    const third = await call();
    expect(third.statusCode).toBe(429);
    expect(third.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });
});
