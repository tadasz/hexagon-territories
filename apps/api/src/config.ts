import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { WALK_LIMITS } from './modules/walks/limits.js';
import { StringEnum } from './schemas/common.js';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

/** Minimum length of `JWT_SECRET` (specs/002-auth-and-factions/data-model.md §7). */
export const JWT_SECRET_MIN_LENGTH = 32;

/**
 * Every environment variable the API reads, with its type, constraints and default. Values arrive
 * as strings; `loadConfig` converts them (`"3000"` -> 3000, `"false"` -> false) before validation.
 * Feature 002 adds the `JWT_*`, `APPLE_*`, account and rate-limit variables (data-model.md §7);
 * feature 003 adds the `WALK_*` limits.
 */
export const EnvSchema = Type.Object({
  NODE_ENV: StringEnum(NODE_ENVS, { default: 'development' }),
  PORT: Type.Integer({ minimum: 1, maximum: 65535, default: 3000 }),
  HOST: Type.String({ minLength: 1, default: '0.0.0.0' }),
  DATABASE_URL: Type.String({
    pattern: '^postgres(ql)?://',
    description:
      'node-postgres connection string, e.g. postgres://nature:nature@localhost:5432/nature',
  }),
  LOG_LEVEL: StringEnum(LOG_LEVELS, { default: 'info' }),
  JOBS_ENABLED: Type.Boolean({ default: true }),
  TRUST_PROXY: Type.Boolean({
    default: false,
    description: 'Fastify trustProxy: rate limits key by the real client IP behind a proxy',
  }),
  JWT_SECRET: Type.String({
    minLength: JWT_SECRET_MIN_LENGTH,
    description: 'HS256 signing key for access tokens; at least 32 characters',
  }),
  JWT_ACCESS_TTL_S: Type.Integer({ minimum: 60, default: 900 }),
  REFRESH_TTL_DAYS: Type.Integer({ minimum: 1, default: 60 }),
  APPLE_CLIENT_IDS: Type.String({
    minLength: 1,
    default: 'com.natureexplorer.app',
    description: 'Comma-separated bundle identifiers accepted as the identity token audience',
  }),
  APPLE_JWKS_URL: Type.String({
    pattern: '^https?://',
    default: 'https://appleid.apple.com/auth/keys',
  }),
  AUTH_RATE_LIMIT_PER_MIN: Type.Integer({ minimum: 1, default: 20 }),
  ACCOUNT_PURGE_GRACE_DAYS: Type.Integer({ minimum: 0, default: 30 }),
  EXPORT_TTL_DAYS: Type.Integer({ minimum: 1, default: 7 }),
  EXPORT_URL_TTL_S: Type.Integer({ minimum: 60, default: 3600 }),
  S3_ENDPOINT: Type.String({ pattern: '^https?://', default: 'http://localhost:9000' }),
  S3_PUBLIC_ENDPOINT: Type.Optional(
    Type.String({
      pattern: '^https?://',
      description: 'Endpoint written into presigned URLs when it differs from S3_ENDPOINT',
    }),
  ),
  S3_REGION: Type.String({ minLength: 1, default: 'eu-central-1' }),
  S3_BUCKET: Type.String({ minLength: 1, default: 'nature-media' }),
  S3_ACCESS_KEY: Type.Optional(Type.String({ minLength: 1 })),
  S3_SECRET_KEY: Type.Optional(Type.String({ minLength: 1 })),
  // Walk tracking (specs/003-walk-tracking/data-model.md §7); defaults equal modules/walks/limits.ts.
  WALK_AUTOFINISH_AFTER_H: Type.Integer({ minimum: 1, default: WALK_LIMITS.AUTOFINISH_AFTER_H }),
  WALK_SAMPLE_RETENTION_DAYS: Type.Integer({
    minimum: 1,
    default: WALK_LIMITS.SAMPLE_RETENTION_DAYS,
  }),
  WALK_XP_DAILY_CAP: Type.Integer({ minimum: 0, default: WALK_LIMITS.WALK_XP_DAILY_CAP }),
  WALK_INGEST_BATCHES_PER_15MIN: Type.Integer({
    minimum: 1,
    default: WALK_LIMITS.BATCHES_PER_WINDOW,
  }),
  WALK_SAMPLES_PER_DAY: Type.Integer({ minimum: 1, default: WALK_LIMITS.SAMPLES_PER_DAY }),
});

export type Env = Static<typeof EnvSchema>;

/** Typed, validated configuration derived from the environment. */
export interface AppConfig {
  env: NodeEnv;
  host: string;
  port: number;
  logLevel: LogLevel;
  databaseUrl: string;
  jobsEnabled: boolean;
  trustProxy: boolean;
  jwt: {
    secret: string;
    accessTtlS: number;
    refreshTtlDays: number;
  };
  apple: {
    /** Accepted `aud` values (the app's bundle identifiers). */
    clientIds: string[];
    jwksUrl: string;
  };
  account: {
    purgeGraceDays: number;
    exportTtlDays: number;
    exportUrlTtlS: number;
  };
  rateLimit: {
    /** Requests per minute per client address on `/v1/auth/*`. */
    authPerMin: number;
  };
  s3: {
    endpoint: string;
    publicEndpoint: string | undefined;
    region: string;
    bucket: string;
    accessKey: string | undefined;
    secretKey: string | undefined;
  };
  /** Walk-tracking limits (feature 003); the env only overrides them for load tests. */
  walks: {
    autofinishAfterH: number;
    sampleRetentionDays: number;
    xpDailyCap: number;
    ingestBatchesPer15Min: number;
    samplesPerDay: number;
  };
}

export interface ConfigIssue {
  variable: string;
  message: string;
}

export class ConfigError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(
      `Invalid environment configuration:\n${issues
        .map((issue) => `  - ${issue.variable}: ${issue.message}`)
        .join('\n')}`,
    );
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/** `"a, b,,c"` -> `['a', 'b', 'c']`. */
export function parseCommaList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Reads the variables named in `EnvSchema` from `env` (default `process.env`), applies defaults,
 * converts strings to the declared types and validates. Empty strings count as unset. Throws
 * `ConfigError` listing every failing variable, so a misconfigured deployment fails at boot with
 * one readable message instead of at the first query.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const raw: Record<string, unknown> = {};
  for (const key of Object.keys(EnvSchema.properties)) {
    const value = env[key];
    if (value !== undefined && value !== '') raw[key] = value;
  }

  const converted = Value.Convert(EnvSchema, Value.Default(EnvSchema, raw));
  if (!Value.Check(EnvSchema, converted)) {
    const issues = [...Value.Errors(EnvSchema, converted)].map((error) => ({
      variable: error.path.replace(/^\//, '') || '(root)',
      message: error.message,
    }));
    throw new ConfigError(issues);
  }

  const clientIds = parseCommaList(converted.APPLE_CLIENT_IDS);
  if (clientIds.length === 0) {
    throw new ConfigError([
      { variable: 'APPLE_CLIENT_IDS', message: 'Expected at least one bundle identifier' },
    ]);
  }

  return {
    env: converted.NODE_ENV,
    host: converted.HOST,
    port: converted.PORT,
    logLevel: converted.LOG_LEVEL,
    databaseUrl: converted.DATABASE_URL,
    jobsEnabled: converted.JOBS_ENABLED,
    trustProxy: converted.TRUST_PROXY,
    jwt: {
      secret: converted.JWT_SECRET,
      accessTtlS: converted.JWT_ACCESS_TTL_S,
      refreshTtlDays: converted.REFRESH_TTL_DAYS,
    },
    apple: {
      clientIds,
      jwksUrl: converted.APPLE_JWKS_URL,
    },
    account: {
      purgeGraceDays: converted.ACCOUNT_PURGE_GRACE_DAYS,
      exportTtlDays: converted.EXPORT_TTL_DAYS,
      exportUrlTtlS: converted.EXPORT_URL_TTL_S,
    },
    rateLimit: {
      authPerMin: converted.AUTH_RATE_LIMIT_PER_MIN,
    },
    s3: {
      endpoint: converted.S3_ENDPOINT,
      publicEndpoint: converted.S3_PUBLIC_ENDPOINT,
      region: converted.S3_REGION,
      bucket: converted.S3_BUCKET,
      accessKey: converted.S3_ACCESS_KEY,
      secretKey: converted.S3_SECRET_KEY,
    },
    walks: {
      autofinishAfterH: converted.WALK_AUTOFINISH_AFTER_H,
      sampleRetentionDays: converted.WALK_SAMPLE_RETENTION_DAYS,
      xpDailyCap: converted.WALK_XP_DAILY_CAP,
      ingestBatchesPer15Min: converted.WALK_INGEST_BATCHES_PER_15MIN,
      samplesPerDay: converted.WALK_SAMPLES_PER_DAY,
    },
  };
}
