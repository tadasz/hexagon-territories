import { Type } from '@sinclair/typebox';
import { afterEach, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { AppError } from '../../src/errors.js';
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
