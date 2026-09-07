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
  components: {
    schemas: Record<string, { type?: string; required?: string[] }>;
    securitySchemes?: Record<string, unknown>;
  };
}

/** Every path and operationId of contracts/openapi.yaml (feature 002) plus the 001 ops routes. */
const EXPECTED_OPERATIONS: Record<string, Record<string, string>> = {
  '/health': { get: 'getHealth' },
  '/openapi.json': { get: 'getOpenApiDocument' },
  '/v1/auth/apple': { post: 'signInWithApple' },
  '/v1/auth/refresh': { post: 'refreshTokens' },
  '/v1/auth/logout': { post: 'logout' },
  '/v1/factions': { get: 'listFactions' },
  '/v1/me': { get: 'getMe', patch: 'updateMe', delete: 'deleteMe' },
  '/v1/me/faction': { post: 'selectFaction' },
  '/v1/me/export': { get: 'getExport' },
};

const EXPECTED_SCHEMAS = [
  'Error',
  'HealthResponse',
  'AuthAppleRequest',
  'TokenPair',
  'AuthResponse',
  'RefreshRequest',
  'LogoutRequest',
  'Me',
  'MeUpdate',
  'FactionSelect',
  'AccountDeletion',
  'ExportStatus',
  'FactionStats',
  'Faction',
  'FactionsResponse',
];

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

  it('describes every path and operationId of the 002 contract', () => {
    expect(Object.keys(doc.paths).sort()).toEqual(Object.keys(EXPECTED_OPERATIONS).sort());
    for (const [path, methods] of Object.entries(EXPECTED_OPERATIONS)) {
      for (const [method, operationId] of Object.entries(methods)) {
        expect(doc.paths[path]?.[method]?.operationId, `${method} ${path}`).toBe(operationId);
      }
    }
  });

  it('marks /v1/me* and logout with bearerAuth and the rest as public', () => {
    expect(doc.components.securitySchemes).toMatchObject({
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    });
    const security = (path: string, method: string) =>
      (doc.paths[path]?.[method] as { security?: unknown[] } | undefined)?.security;
    expect(security('/v1/me', 'get')).toEqual([{ bearerAuth: [] }]);
    expect(security('/v1/me', 'patch')).toEqual([{ bearerAuth: [] }]);
    expect(security('/v1/me', 'delete')).toEqual([{ bearerAuth: [] }]);
    expect(security('/v1/me/faction', 'post')).toEqual([{ bearerAuth: [] }]);
    expect(security('/v1/me/export', 'get')).toEqual([{ bearerAuth: [] }]);
    expect(security('/v1/auth/logout', 'post')).toEqual([{ bearerAuth: [] }]);
    expect(security('/v1/auth/apple', 'post')).toEqual([]);
    expect(security('/v1/auth/refresh', 'post')).toEqual([]);
    expect(security('/v1/factions', 'get')).toEqual([]);
  });

  it('exposes every component schema of the contract by name', () => {
    expect(Object.keys(doc.components.schemas).sort()).toEqual([...EXPECTED_SCHEMAS].sort());
    expect(doc.components.schemas.Me?.required).toEqual([
      'id',
      'displayName',
      'factionId',
      'factionChangedAt',
      'factionChangeAvailableAt',
      'xp',
      'level',
      'role',
      'createdAt',
      'suggestedFactionId',
    ]);
    expect(JSON.stringify(doc.paths['/v1/me/faction']?.post?.responses)).toContain(
      '#/components/schemas/Me',
    );
    expect(Object.keys(doc.paths['/v1/me/faction']?.post?.responses ?? {})).toEqual([
      '200',
      '400',
      '401',
      '404',
      '409',
    ]);
    expect(Object.keys(doc.paths['/v1/me/export']?.get?.responses ?? {})).toEqual([
      '200',
      '202',
      '401',
    ]);
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
