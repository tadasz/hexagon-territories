import { buildApp, type BuildAppOptions } from '../../src/app.js';
import { loadConfig, type AppConfig } from '../../src/config.js';

/** A config that never reaches a database: port 1 refuses connections immediately. */
export const UNREACHABLE_DATABASE_URL = 'postgres://nature:nature@127.0.0.1:1/nature';

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...loadConfig({
      DATABASE_URL: UNREACHABLE_DATABASE_URL,
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    }),
    ...overrides,
  };
}

/**
 * Builds the app for unit tests: no logging, no pg-boss, and a readiness probe that never opens
 * a socket (`dbPing` defaults to success; pass a rejecting function for the degraded path).
 */
export function buildUnitApp(opts: Partial<BuildAppOptions> = {}) {
  return buildApp({
    config: testConfig(),
    logger: false,
    jobs: false,
    dbPing: () => Promise.resolve(),
    ...opts,
  });
}
