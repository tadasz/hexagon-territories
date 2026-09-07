import { randomUUID } from 'node:crypto';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { AppConfig } from './config.js';
import type { Pool } from './db/client.js';
import { healthRoutes } from './modules/health/routes.js';
import { dbPlugin } from './plugins/db.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { jobsPlugin, type JobBoss } from './plugins/jobs.js';
import { openapiPlugin } from './plugins/openapi.js';
import { API_VERSION } from './version.js';

export interface BuildAppOptions {
  config: AppConfig;
  /** Fastify logger option; defaults to pino at `config.logLevel`. `false` silences tests. */
  logger?: FastifyServerOptions['logger'];
  /** Reuse an existing pool instead of opening one from `config.databaseUrl`. */
  pool?: Pool;
  /** Override the readiness probe (unit tests). */
  dbPing?: () => Promise<void>;
  /** Job wiring: `false` disables pg-boss regardless of config; an object injects a fake boss. */
  jobs?: false | { boss?: JobBoss; retryMs?: number };
}

/**
 * Builds the Fastify application without listening. Plugin order matters: error handler first
 * (so every later failure is normalised), then db, OpenAPI (component schemas), routes, jobs.
 */
export async function buildApp(opts: BuildAppOptions) {
  const { config } = opts;
  const app = Fastify({
    logger: opts.logger ?? { level: config.logLevel },
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
    ajv: { customOptions: { removeAdditional: false, coerceTypes: 'array' } },
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  await app.register(errorHandlerPlugin, { exposeInternalErrors: config.env !== 'production' });
  await app.register(dbPlugin, {
    connectionString: config.databaseUrl,
    pool: opts.pool,
    ping: opts.dbPing,
  });
  await app.register(openapiPlugin, { version: API_VERSION });
  await app.register(healthRoutes);
  await app.register(jobsPlugin, {
    enabled: opts.jobs !== false && config.jobsEnabled,
    boss: opts.jobs === false ? undefined : opts.jobs?.boss,
    retryMs: opts.jobs === false ? undefined : opts.jobs?.retryMs,
  });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
