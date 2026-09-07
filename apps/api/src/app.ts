import { randomUUID } from 'node:crypto';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { AppConfig } from './config.js';
import type { Pool } from './db/client.js';
import type { ObjectStorage } from './lib/storage.js';
import { systemClock, type Clock } from './lib/time.js';
import { JoseAppleVerifier, type AppleTokenVerifier } from './modules/auth/apple.js';
import { authRoutes } from './modules/auth/routes.js';
import { factionsRoutes } from './modules/factions/routes.js';
import { healthRoutes } from './modules/health/routes.js';
import { meRoutes } from './modules/me/routes.js';
import { adminReckoningRoutes } from './modules/territory/admin-routes.js';
import { territoryRoutes } from './modules/territory/routes.js';
import { walksRoutes } from './modules/walks/routes.js';
import { authPlugin, type AuthUserSource } from './plugins/auth.js';
import { dbPlugin } from './plugins/db.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { jobsPlugin, type JobBoss } from './plugins/jobs.js';
import { openapiPlugin } from './plugins/openapi.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';
import { storagePlugin } from './plugins/storage.js';
import { API_VERSION } from './version.js';

export interface BuildAppOptions {
  config: AppConfig;
  /** Fastify logger option; defaults to pino at `config.logLevel`. `false` silences tests. */
  logger?: FastifyServerOptions['logger'];
  /** Reuse an existing pool instead of opening one from `config.databaseUrl`. */
  pool?: Pool;
  /** Override the readiness probe (unit tests). */
  dbPing?: () => Promise<void>;
  /**
   * Job wiring: `false` disables pg-boss regardless of config; an object injects a fake boss.
   * `catchUp: false` skips the start-up reckoning catch-up (integration tests seed their own weeks).
   */
  jobs?: false | { boss?: JobBoss; retryMs?: number; catchUp?: boolean };
  /** Object storage; defaults to S3 from config (tests inject `MemoryObjectStorage`). */
  storage?: ObjectStorage;
  /** Time source for tokens, locks, purge and export windows (tests inject `FakeClock`). */
  clock?: Clock;
  /** Apple identity-token verifier; defaults to `jose` against `config.apple.jwksUrl`. */
  appleVerifier?: AppleTokenVerifier;
  /** User lookup for the auth plugin; defaults to Drizzle on the shared pool. */
  authUsers?: AuthUserSource;
}

/**
 * Paths pino censors in every log line (research.md R14, FR-015): no e-mail addresses, identity
 * tokens or session credentials ever reach the logs, even when an object is logged by accident.
 */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'email',
  'identityToken',
  'refreshToken',
  'accessToken',
  'authorizationCode',
  '*.email',
  '*.identityToken',
  '*.refreshToken',
  '*.accessToken',
  '*.authorizationCode',
  'body.email',
  'body.identityToken',
  'body.refreshToken',
] as const;

export const LOG_REDACT_CENSOR = '[redacted]';

function loggerOption(opts: BuildAppOptions): FastifyServerOptions['logger'] {
  const redact = { paths: [...LOG_REDACT_PATHS], censor: LOG_REDACT_CENSOR };
  if (opts.logger === undefined) return { level: opts.config.logLevel, redact };
  if (typeof opts.logger === 'object') return { redact, ...opts.logger };
  return opts.logger;
}

/**
 * Builds the Fastify application without listening. Plugin order matters: error handler first
 * (so every later failure is normalised), then db, storage, rate limit, OpenAPI (component
 * schemas), auth, routes, jobs.
 */
export async function buildApp(opts: BuildAppOptions) {
  const { config } = opts;
  const clock = opts.clock ?? systemClock;
  const app = Fastify({
    logger: loggerOption(opts),
    trustProxy: config.trustProxy,
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
  await app.register(storagePlugin, { s3: config.s3, storage: opts.storage });
  await app.register(rateLimitPlugin, { authPerMin: config.rateLimit.authPerMin });
  await app.register(openapiPlugin, { version: API_VERSION });
  await app.register(authPlugin, {
    jwtSecret: config.jwt.secret,
    clock,
    ...(opts.authUsers ? { users: opts.authUsers } : {}),
  });

  const verifier =
    opts.appleVerifier ??
    new JoseAppleVerifier({
      jwksUrl: config.apple.jwksUrl,
      clientIds: config.apple.clientIds,
      clock,
    });

  await app.register(healthRoutes);
  await app.register(authRoutes, { config, clock, verifier });
  await app.register(factionsRoutes, { clock });
  await app.register(meRoutes, { config, clock });
  await app.register(walksRoutes, { config, clock });
  await app.register(territoryRoutes, { config, clock });
  await app.register(adminReckoningRoutes, { config, clock });
  await app.register(jobsPlugin, {
    enabled: opts.jobs !== false && config.jobsEnabled,
    boss: opts.jobs === false ? undefined : opts.jobs?.boss,
    retryMs: opts.jobs === false ? undefined : opts.jobs?.retryMs,
    catchUp: opts.jobs === false ? undefined : opts.jobs?.catchUp,
    clock,
    config,
  });

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
