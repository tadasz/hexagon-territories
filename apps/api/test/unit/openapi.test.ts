import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { API_VERSION } from '../../src/version.js';
import { buildUnitApp } from '../helpers/app.js';

interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<
    string,
    Record<string, { operationId?: string; responses: Record<string, unknown> }>
  >;
  components: { schemas: Record<string, { type?: string; required?: string[] }> };
}

describe('GET /openapi.json', () => {
  let app: App;
  let doc: OpenApiDoc;

  beforeAll(async () => {
    app = await buildUnitApp();
    const res = await app.inject({ url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    doc = res.json<OpenApiDoc>();
  });
  afterAll(async () => {
    await app.close();
  });

  it('is an OpenAPI 3.1 document with the package version', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Nature Explorer API');
    expect(doc.info.version).toBe(API_VERSION);
  });

  it('describes /health with 200 and 503 responses referencing HealthResponse', () => {
    const health = doc.paths['/health']?.get;
    expect(health?.operationId).toBe('getHealth');
    expect(Object.keys(health?.responses ?? {})).toEqual(['200', '503']);
    expect(JSON.stringify(health)).toContain('#/components/schemas/HealthResponse');
  });

  it('describes itself', () => {
    expect(doc.paths['/openapi.json']?.get?.operationId).toBe('getOpenApiDocument');
  });

  it('exposes the shared Error and HealthResponse component schemas', () => {
    expect(doc.components.schemas.Error).toMatchObject({
      type: 'object',
      required: ['error', 'requestId'],
    });
    expect(doc.components.schemas.HealthResponse).toMatchObject({
      type: 'object',
      required: ['status', 'db', 'version'],
    });
  });
});
