import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { MemoryObjectStorage } from '../lib/storage.js';

/**
 * Prints the generated OpenAPI document to stdout (research.md R10). Builds the app with
 * placeholder configuration, no jobs, a no-op readiness probe and in-memory storage; the
 * node-postgres pool is lazy, so no database connection is opened. Used by
 * `pnpm --filter @nature/api-schema snapshot` and its staleness test.
 */
const config = loadConfig({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://print:print@127.0.0.1:1/print',
  JWT_SECRET: 'openapi-print-placeholder-secret-0123456789',
  APPLE_CLIENT_IDS: 'com.natureexplorer.app',
  JOBS_ENABLED: 'false',
});

const app = await buildApp({
  config,
  logger: false,
  jobs: false,
  dbPing: () => Promise.resolve(),
  storage: new MemoryObjectStorage(),
});
try {
  await app.ready();
  process.stdout.write(JSON.stringify(app.swagger()));
} finally {
  await app.close();
}
