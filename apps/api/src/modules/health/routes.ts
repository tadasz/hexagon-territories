import type { FastifyPluginCallbackTypebox } from '@fastify/type-provider-typebox';
import { API_VERSION } from '../../version.js';
import { HealthResponseRef, type HealthResponse } from './schemas.js';

/**
 * `GET /health`: 200 `{status: ok, db: ok}` when Postgres answers `SELECT 1` within 2 s, otherwise
 * 503 `{status: degraded, db: error}`. Unversioned because load balancers and Compose call it.
 */
export const healthRoutes: FastifyPluginCallbackTypebox = (fastify, _opts, done) => {
  fastify.get(
    '/health',
    {
      schema: {
        tags: ['ops'],
        operationId: 'getHealth',
        summary: 'Liveness and database readiness',
        description:
          'Runs `SELECT 1` against Postgres with a 2 s timeout. Returns 200 when the database answers, 503 with `db: "error"` otherwise. Never requires authentication.',
        response: {
          200: { ...HealthResponseRef, description: 'API and database are reachable' },
          503: { ...HealthResponseRef, description: 'API is up but the database is not reachable' },
        },
      },
    },
    async (request, reply) => {
      try {
        await fastify.dbPing();
      } catch (err) {
        request.log.warn({ err }, 'health: database ping failed');
        const degraded: HealthResponse = { status: 'degraded', db: 'error', version: API_VERSION };
        return reply.code(503).send(degraded);
      }
      const ok: HealthResponse = { status: 'ok', db: 'ok', version: API_VERSION };
      return ok;
    },
  );
  done();
};
