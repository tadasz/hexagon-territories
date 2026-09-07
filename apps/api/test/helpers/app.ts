import { buildApp, type BuildAppOptions } from '../../src/app.js';
import { loadConfig, type AppConfig } from '../../src/config.js';
import { MemoryObjectStorage } from '../../src/lib/storage.js';

/** A config that never reaches a database: port 1 refuses connections immediately. */
export const UNREACHABLE_DATABASE_URL = 'postgres://nature:nature@127.0.0.1:1/nature';

/** Dev-grade secret for tests only (≥ 32 characters, see config.ts). */
export const TEST_JWT_SECRET = 'test-secret-test-secret-test-secret-0123456789';
export const TEST_APPLE_CLIENT_ID = 'com.natureexplorer.app';
/** A JWKS URL nothing answers on; suites that sign in override it with their `AppleStub`. */
export const UNREACHABLE_JWKS_URL = 'http://127.0.0.1:1/keys';

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...loadConfig({
      DATABASE_URL: UNREACHABLE_DATABASE_URL,
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      JWT_SECRET: TEST_JWT_SECRET,
      APPLE_CLIENT_IDS: TEST_APPLE_CLIENT_ID,
      APPLE_JWKS_URL: UNREACHABLE_JWKS_URL,
      // High enough that ordinary suites never trip it; rate-limit tests lower it explicitly.
      AUTH_RATE_LIMIT_PER_MIN: '1000',
    }),
    ...overrides,
  };
}

/**
 * Builds the app for unit tests: no logging, no pg-boss, in-memory storage and a readiness probe
 * that never opens a socket (`dbPing` defaults to success; pass a rejecting function for the
 * degraded path).
 */
export function buildUnitApp(opts: Partial<BuildAppOptions> = {}) {
  return buildApp({
    config: testConfig(),
    logger: false,
    jobs: false,
    dbPing: () => Promise.resolve(),
    storage: new MemoryObjectStorage(),
    ...opts,
  });
}
