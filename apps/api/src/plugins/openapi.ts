import swagger from '@fastify/swagger';
import { Type } from '@sinclair/typebox';
import fp from 'fastify-plugin';
import {
  AuthAppleRequestSchema,
  AuthResponseSchema,
  LogoutRequestSchema,
  RefreshRequestSchema,
  TokenPairSchema,
} from '../modules/auth/schemas.js';
import {
  FactionSchema,
  FactionStatsSchema,
  FactionsResponseSchema,
} from '../modules/factions/schemas.js';
import { HealthResponseSchema } from '../modules/health/schemas.js';
import {
  AccountDeletionSchema,
  ExportStatusSchema,
  FactionSelectSchema,
  MeSchema,
  MeUpdateSchema,
} from '../modules/me/schemas.js';
import { TERRITORY_COMPONENT_SCHEMAS } from '../modules/territory/schemas.js';
import { WALK_COMPONENT_SCHEMAS } from '../modules/walks/schemas.js';
import { ErrorSchema } from '../schemas/error.js';

export interface OpenApiPluginOptions {
  version: string;
}

const OpenApiDocumentSchema = Type.Object(
  {
    openapi: Type.String({ pattern: '^3\\.1\\.\\d+$' }),
    info: Type.Object({}, { additionalProperties: true }),
    paths: Type.Object({}, { additionalProperties: true }),
    components: Type.Object({}, { additionalProperties: true }),
  },
  { additionalProperties: true },
);

/** Every component schema, in a stable order (referenced by `$id`, see `refResolver`). */
export const COMPONENT_SCHEMAS = [
  ErrorSchema,
  HealthResponseSchema,
  FactionStatsSchema,
  FactionSchema,
  FactionsResponseSchema,
  MeSchema,
  MeUpdateSchema,
  FactionSelectSchema,
  AccountDeletionSchema,
  ExportStatusSchema,
  AuthAppleRequestSchema,
  TokenPairSchema,
  AuthResponseSchema,
  RefreshRequestSchema,
  LogoutRequestSchema,
  // feature 003
  ...WALK_COMPONENT_SCHEMAS,
  // feature 004
  ...TERRITORY_COMPONENT_SCHEMAS,
];

/**
 * Registers the shared component schemas, configures `@fastify/swagger` in OpenAPI 3.1 mode
 * (with the `bearerAuth` security scheme of feature 002) and serves the generated document at
 * `GET /openapi.json`. Must be registered before any route so their TypeBox schemas are collected.
 */
export const openapiPlugin = fp<OpenApiPluginOptions>(
  async (fastify, opts) => {
    for (const schema of COMPONENT_SCHEMAS) fastify.addSchema(schema);

    await fastify.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'Nature Explorer API',
          version: opts.version,
          description:
            'Generated at startup from the TypeBox schemas of the registered routes. Every non-2xx response uses the shared `Error` schema and echoes the request id in `x-request-id`. `/v1/me*`, `/v1/walks*`, `/v1/hexes*`, `/v1/reckonings/*` and `/v1/auth/logout` need a bearer access token (`bearerAuth`); `/v1/admin/*` additionally needs role `admin`. Walk scoring happens only in POST /v1/walks/{id}/finish (docs/territory-rules.md "Scoring at walk finish"); sample uploads store raw data and answer a provisional filter result; ownership of hexagons changes only inside the `reckoning.weekly` job (docs/territory-rules.md "Weekly reckoning") — the hex and reckoning endpoints read its results, the admin endpoint triggers it.',
        },
        servers: [{ url: 'http://localhost:3000', description: 'Local development (make dev)' }],
        tags: [
          { name: 'ops', description: 'Health and introspection' },
          {
            name: 'auth',
            description:
              'Sign in with Apple, token refresh, logout (rate limited per client address)',
          },
          {
            name: 'factions',
            description: 'The three factions with live statistics and the suggested faction',
          },
          {
            name: 'me',
            description: "The signed-in player's profile, faction, deletion and export",
          },
          {
            name: 'walks',
            description: 'Walk sessions of the signed-in player (paths are private to their owner)',
          },
          {
            name: 'territory',
            description: 'Hex ownership, weekly pressure and reckoning results',
          },
          { name: 'admin', description: 'Operator endpoints (role admin)' },
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: 'http',
              scheme: 'bearer',
              bearerFormat: 'JWT',
              description:
                'Access token from POST /v1/auth/apple or /v1/auth/refresh (HS256, 15 minutes)',
            },
          },
        },
      },
      refResolver: {
        // Name component schemas after their `$id` instead of `def-0`, `def-1`, ...
        buildLocalReference(json, _baseUri, _fragment, i) {
          return typeof json.$id === 'string' ? json.$id : `def-${i}`;
        },
      },
    });

    fastify.get(
      '/openapi.json',
      {
        schema: {
          tags: ['ops'],
          operationId: 'getOpenApiDocument',
          summary: 'The OpenAPI 3.1 document describing this server',
          description:
            'Generated at startup from the registered routes` TypeBox schemas. Snapshotted into packages/api-schema/openapi.json, from which the iOS client is generated.',
          security: [],
          response: { 200: OpenApiDocumentSchema },
        },
      },
      () => fastify.swagger(),
    );
  },
  { name: 'openapi', fastify: '5.x' },
);
