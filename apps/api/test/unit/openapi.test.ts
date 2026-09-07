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
  // feature 003
  '/v1/walks': { post: 'createWalk', get: 'listWalks' },
  '/v1/walks/{id}/samples': { post: 'uploadWalkSamples' },
  '/v1/walks/{id}/finish': { post: 'finishWalk' },
  '/v1/walks/{id}': { get: 'getWalk' },
  // feature 004
  '/v1/hexes': { get: 'listHexes' },
  '/v1/hexes/{h3}': { get: 'getHex' },
  '/v1/reckonings/latest': { get: 'getLatestReckoning' },
  '/v1/admin/reckonings/{weekId}': { post: 'runReckoning', get: 'getReckoning' },
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
  // feature 003
  'WalkCreateRequest',
  'WalkCreated',
  'LocationSample',
  'PedometerWindow',
  'SampleBatchRequest',
  'RejectedSample',
  'SampleBatchResult',
  'WalkFinishRequest',
  'WeekStanding',
  'WalkHex',
  'LineString',
  'WalkSummary',
  'WalkListItem',
  'WalkListPage',
  // feature 004
  'HexListItem',
  'HexList',
  'FactionStrength',
  'HexWeekFaction',
  'HexWeek',
  'HexCaptain',
  'HexMe',
  'HexReckoningEntry',
  'HexDetail',
  'FactionTotal',
  'ReckoningLatest',
  'ReckoningRunRequest',
  'FlipPreview',
  'ReckoningRunResult',
  'ReckoningQueued',
  'ReckoningStatus',
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

  it('describes every path and operationId of the 002 and 003 contracts', () => {
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
    for (const [path, methods] of Object.entries(EXPECTED_OPERATIONS)) {
      if (!path.startsWith('/v1/walks')) continue;
      for (const method of Object.keys(methods)) {
        expect(security(path, method), `${method} ${path}`).toEqual([{ bearerAuth: [] }]);
        expect((doc.paths[path]?.[method] as { tags?: string[] } | undefined)?.tags).toEqual([
          'walks',
        ]);
      }
    }
    // feature 004: territory reads need a token; admin routes are tagged admin
    for (const [path, method, tag] of [
      ['/v1/hexes', 'get', 'territory'],
      ['/v1/hexes/{h3}', 'get', 'territory'],
      ['/v1/reckonings/latest', 'get', 'territory'],
      ['/v1/admin/reckonings/{weekId}', 'post', 'admin'],
      ['/v1/admin/reckonings/{weekId}', 'get', 'admin'],
    ] as const) {
      expect(security(path, method), `${method} ${path}`).toEqual([{ bearerAuth: [] }]);
      expect((doc.paths[path]?.[method] as { tags?: string[] } | undefined)?.tags).toEqual([tag]);
    }
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

  it('describes the walk operations as the 003 contract does', () => {
    expect(Object.keys(doc.paths['/v1/walks']?.post?.responses ?? {}).sort()).toEqual([
      '200',
      '201',
      '400',
      '401',
      '403',
      '409',
      '429',
    ]);
    expect(Object.keys(doc.paths['/v1/walks/{id}/samples']?.post?.responses ?? {})).toEqual([
      '200',
      '400',
      '401',
      '404',
      '409',
      '429',
    ]);
    expect(Object.keys(doc.paths['/v1/walks/{id}/finish']?.post?.responses ?? {})).toEqual([
      '200',
      '400',
      '401',
      '404',
    ]);
    expect(Object.keys(doc.paths['/v1/walks/{id}']?.get?.responses ?? {})).toEqual([
      '200',
      '401',
      '404',
    ]);
    expect(doc.components.schemas.WalkSummary?.required).toEqual([
      'walkId',
      'clientWalkId',
      'status',
      'finishReason',
      'startedAt',
      'endedAt',
      'finishedAt',
      'weekId',
      'distanceM',
      'durationS',
      'steps',
      'sampleCount',
      'hexCount',
      'xp',
      'scored',
      'flags',
      'hexes',
      'path',
    ]);
    expect(doc.components.schemas.WalkListItem?.required).toEqual([
      'walkId',
      'clientWalkId',
      'status',
      'finishReason',
      'startedAt',
      'endedAt',
      'weekId',
      'distanceM',
      'durationS',
      'hexCount',
      'xp',
      'scored',
      'flags',
    ]);
    expect(doc.components.schemas.SampleBatchResult?.required).toEqual([
      'stored',
      'duplicates',
      'accepted',
      'rejected',
      'sampleCount',
    ]);
    expect(doc.components.schemas.WeekStanding?.required).toEqual([
      'leader',
      'myFactionShare',
      'owner',
    ]);
    expect(JSON.stringify(doc.paths['/v1/walks/{id}/finish']?.post?.responses)).toContain(
      '#/components/schemas/WalkSummary',
    );
    expect(JSON.stringify(doc.components.schemas.WalkSummary)).toContain(
      '#/components/schemas/LineString',
    );
  });

  it('describes the territory and admin operations as the 004 contract does (SC-008)', () => {
    expect(Object.keys(doc.paths['/v1/hexes']?.get?.responses ?? {})).toEqual([
      '200',
      '400',
      '401',
      '429',
    ]);
    expect(Object.keys(doc.paths['/v1/hexes/{h3}']?.get?.responses ?? {})).toEqual([
      '200',
      '400',
      '401',
    ]);
    expect(Object.keys(doc.paths['/v1/reckonings/latest']?.get?.responses ?? {})).toEqual([
      '200',
      '401',
    ]);
    expect(Object.keys(doc.paths['/v1/admin/reckonings/{weekId}']?.post?.responses ?? {})).toEqual([
      '200',
      '202',
      '400',
      '401',
      '403',
      '409',
      '503',
    ]);
    expect(Object.keys(doc.paths['/v1/admin/reckonings/{weekId}']?.get?.responses ?? {})).toEqual([
      '200',
      '401',
      '403',
      '404',
    ]);
    expect(doc.components.schemas.HexListItem?.required).toEqual([
      'h3',
      'res',
      'owner',
      'ownerSince',
      'pressureLeader',
      'contested',
    ]);
    expect(doc.components.schemas.ReckoningLatest?.required).toEqual([
      'weekId',
      'ranAt',
      'nextAt',
      'inProgress',
      'factionTotals',
      'myFlips',
      'myFlippedHexes',
    ]);
    expect(JSON.stringify(doc.components.schemas.HexDetail)).toContain(
      '#/components/schemas/HexCaptain',
    );
    expect(JSON.stringify(doc.paths['/v1/hexes']?.get?.responses)).toContain(
      '#/components/schemas/HexList',
    );
    expect(JSON.stringify(doc.paths['/v1/admin/reckonings/{weekId}']?.post?.responses)).toContain(
      '#/components/schemas/ReckoningQueued',
    );
    const owner = (
      doc.components.schemas.HexListItem as { properties?: Record<string, { type?: unknown }> }
    ).properties?.owner;
    expect([...(owner?.type as string[])].sort()).toEqual(['integer', 'null']);
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
