import { afterEach, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { API_VERSION } from '../../src/version.js';
import { buildUnitApp } from '../helpers/app.js';

describe('GET /health', () => {
  let app: App | undefined;
  afterEach(async () => {
    await app?.close();
  });

  it('returns 200 {status: ok, db: ok, version} when the database answers', async () => {
    app = await buildUnitApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok', version: API_VERSION });
    expect(API_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('returns 503 {status: degraded, db: error} when the ping fails', async () => {
    app = await buildUnitApp({ dbPing: () => Promise.reject(new Error('ECONNREFUSED')) });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', db: 'error', version: API_VERSION });
  });

  it('echoes an incoming x-request-id and generates one otherwise', async () => {
    app = await buildUnitApp();
    const echoed = await app.inject({ url: '/health', headers: { 'x-request-id': 'req-123' } });
    expect(echoed.headers['x-request-id']).toBe('req-123');

    const generated = await app.inject({ url: '/health' });
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
