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
            'Generated at startup from the TypeBox schemas of the registered routes. Every non-2xx response uses the shared `Error` schema and echoes the request id in `x-request-id`. `/v1/me*` and `/v1/auth/logout` need a bearer access token (`bearerAuth`).',
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
