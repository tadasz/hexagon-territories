import { Type, type Static } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { StringEnum } from './schemas/common.js';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

/**
 * Every environment variable the API reads, with its type, constraints and default. Values arrive
 * as strings; `loadConfig` converts them (`"3000"` -> 3000, `"false"` -> false) before validation.
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
  S3_ENDPOINT: Type.String({ pattern: '^https?://', default: 'http://localhost:9000' }),
  S3_BUCKET: Type.String({ minLength: 1, default: 'nature-media' }),
  S3_ACCESS_KEY: Type.Optional(Type.String({ minLength: 1 })),
  S3_SECRET_KEY: Type.Optional(Type.String({ minLength: 1 })),
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
  s3: {
    endpoint: string;
    bucket: string;
    accessKey: string | undefined;
    secretKey: string | undefined;
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

  return {
    env: converted.NODE_ENV,
    host: converted.HOST,
    port: converted.PORT,
    logLevel: converted.LOG_LEVEL,
    databaseUrl: converted.DATABASE_URL,
    jobsEnabled: converted.JOBS_ENABLED,
    s3: {
      endpoint: converted.S3_ENDPOINT,
      bucket: converted.S3_BUCKET,
      accessKey: converted.S3_ACCESS_KEY,
      secretKey: converted.S3_SECRET_KEY,
    },
  };
}
