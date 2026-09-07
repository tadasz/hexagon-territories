import { Type } from '@sinclair/typebox';
import { afterEach, describe, expect, it } from 'vitest';
import { LOG_REDACT_CENSOR, type App } from '../../src/app.js';
import { AppError, ERROR_CODES } from '../../src/errors.js';
import { mapError } from '../../src/plugins/error-handler.js';
import { buildUnitApp, testConfig } from '../helpers/app.js';

describe('error handler', () => {
  let app: App | undefined;
  afterEach(async () => {
    await app?.close();
  });

  async function buildWithRoutes(config = testConfig()) {
    const built = await buildUnitApp({ config });
    built.get('/boom', () => {
      throw new Error('kaboom');
    });
    built.get('/teapot', () => {
      throw new AppError(418, 'TEAPOT', 'short and stout', { handle: true });
    });
    built.get(
      '/validated',
      { schema: { querystring: Type.Object({ n: Type.Integer({ minimum: 1 }) }) } },
      (request) => ({ n: request.query.n }),
    );
    return built;
  }

  it('maps unknown routes to 404 NOT_FOUND with the shared envelope', async () => {
    app = await buildWithRoutes();
    const res = await app.inject({ url: '/nope', headers: { 'x-request-id': 'rid-404' } });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route GET /nope not found' },
      requestId: 'rid-404',
    });
    expect(res.headers['x-request-id']).toBe('rid-404');
  });

  it('maps validation failures to 400 VALIDATION_FAILED with issue details', async () => {
    app = await buildWithRoutes();
    const bad = await app.inject({ url: '/validated?n=0' });
    expect(bad.statusCode).toBe(400);
    const body = bad.json<{
      error: { code: string; message: string; details: { issues: unknown[] } };
      requestId: string;
    }>();
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(typeof body.error.message).toBe('string');
    expect(typeof body.requestId).toBe('string');
    expect(body.error.details.issues.length).toBeGreaterThan(0);

    const good = await app.inject({ url: '/validated?n=3' });
    expect(good.statusCode).toBe(200);
    expect(good.json()).toEqual({ n: 3 });
  });

  it('maps unexpected errors to 500 INTERNAL_ERROR, exposing the message outside production', async () => {
    app = await buildWithRoutes();
    const res = await app.inject({ url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: { code: 'INTERNAL_ERROR', message: 'kaboom' } });
  });

  it('hides internal messages in production', async () => {
    app = await buildWithRoutes(testConfig({ env: 'production' }));
    const res = await app.inject({ url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  });

  it('honours AppError status, code and details', async () => {
    app = await buildWithRoutes();
    const res = await app.inject({ url: '/teapot' });
    expect(res.statusCode).toBe(418);
    expect(res.json()).toMatchObject({
      error: { code: 'TEAPOT', message: 'short and stout', details: { handle: true } },
    });
  });
});

describe('error handler (feature 002 codes)', () => {
  let app: App | undefined;
  afterEach(async () => {
    await app?.close();
  });

  it('keeps the 401 / 409 codes and details of AppErrors', async () => {
    app = await buildUnitApp();
    app.get('/unauthorized', () => {
      throw new AppError(401, ERROR_CODES.TOKEN_EXPIRED, 'expired');
    });
    app.get('/locked', () => {
      throw new AppError(409, ERROR_CODES.FACTION_CHANGE_LOCKED, 'locked', {
        nextChangeAt: '2026-10-07T10:00:00.000Z',
      });
    });
    const unauthorized = await app.inject({ url: '/unauthorized' });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json()).toMatchObject({ error: { code: 'TOKEN_EXPIRED' } });

    const locked = await app.inject({ url: '/locked' });
    expect(locked.statusCode).toBe(409);
    expect(locked.json()).toMatchObject({
      error: {
        code: 'FACTION_CHANGE_LOCKED',
        details: { nextChangeAt: '2026-10-07T10:00:00.000Z' },
      },
    });
  });

  it('mirrors details.retryAfterS of a 429 into the retry-after header', async () => {
    app = await buildUnitApp();
    app.get('/limited', () => {
      throw new AppError(429, ERROR_CODES.RATE_LIMITED, 'slow down', { retryAfterS: 17 });
    });
    const res = await app.inject({ url: '/limited' });
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBe('17');
    expect(res.json()).toMatchObject({
      error: { code: 'RATE_LIMITED', details: { retryAfterS: 17 } },
    });
  });

  it('redacts e-mail addresses and credentials from log lines (FR-015)', async () => {
    const lines: string[] = [];
    app = await buildUnitApp({
      logger: { level: 'info', stream: { write: (line: string) => void lines.push(line) } },
    });
    app.get('/log', (request) => {
      request.log.info(
        { email: 'a@b.c', identityToken: 'x', nested: { refreshToken: 'r', accessToken: 'a' } },
        'sensitive object',
      );
      return { ok: true };
    });
    await app.inject({
      url: '/log',
      headers: { authorization: 'Bearer top-secret-access-token' },
    });
    const joined = lines.join('\n');
    expect(joined).toContain('sensitive object');
    expect(joined).not.toContain('a@b.c');
    expect(joined).not.toContain('top-secret-access-token');
    expect(joined).toContain(LOG_REDACT_CENSOR);
    const entry = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.msg === 'sensitive object');
    expect(entry).toMatchObject({
      email: LOG_REDACT_CENSOR,
      identityToken: LOG_REDACT_CENSOR,
      nested: { refreshToken: LOG_REDACT_CENSOR, accessToken: LOG_REDACT_CENSOR },
    });
  });
});

describe('mapError', () => {
  it('uses DB_UNAVAILABLE from an AppError', () => {
    const mapped = mapError(new AppError(503, 'DB_UNAVAILABLE', 'db down'), 'r1', true);
    expect(mapped).toEqual({
      status: 503,
      body: { error: { code: 'DB_UNAVAILABLE', message: 'db down' }, requestId: 'r1' },
    });
  });

  it('never leaks a 5xx message when exposure is off', () => {
    const mapped = mapError(new Error('secret'), 'r2', false);
    expect(mapped.body.error.message).toBe('Internal server error');
    expect(mapped.status).toBe(500);
  });
});
