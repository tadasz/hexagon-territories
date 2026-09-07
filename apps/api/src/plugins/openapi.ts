import swagger from '@fastify/swagger';
import { Type } from '@sinclair/typebox';
import fp from 'fastify-plugin';
import { HealthResponseSchema } from '../modules/health/schemas.js';
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

/**
 * Registers the shared component schemas (`Error`, `HealthResponse`), configures
 * `@fastify/swagger` in OpenAPI 3.1 mode and serves the generated document at `GET /openapi.json`.
 * Must be registered before any route so their TypeBox schemas are collected.
 */
export const openapiPlugin = fp<OpenApiPluginOptions>(
  async (fastify, opts) => {
    fastify.addSchema(ErrorSchema);
    fastify.addSchema(HealthResponseSchema);

    await fastify.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'Nature Explorer API',
          version: opts.version,
          description:
            'Generated at startup from the TypeBox schemas of the registered routes. Every non-2xx response uses the shared `Error` schema and echoes the request id in `x-request-id`.',
        },
        servers: [{ url: 'http://localhost:3000', description: 'Local development (make dev)' }],
        tags: [{ name: 'ops', description: 'Health and introspection' }],
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
            'Generated at startup from the registered routes` TypeBox schemas. Contains the `/health` path and the `Error` component schema.',
          response: { 200: OpenApiDocumentSchema },
        },
      },
      () => fastify.swagger(),
    );
  },
  { name: 'openapi', fastify: '5.x' },
);
