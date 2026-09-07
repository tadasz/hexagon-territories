import { inject } from 'vitest';
import { buildApp, type App, type BuildAppOptions } from '../../src/app.js';
import type { AppConfig } from '../../src/config.js';
import { MemoryObjectStorage } from '../../src/lib/storage.js';
import { AppleStub } from './apple.js';
import { testConfig } from './app.js';
import { asJobBoss, fakeBoss, type FakeBoss } from './auth.js';
import { FakeClock } from './clock.js';
import { createTestDatabase, type TestDatabase } from './db.js';

export interface IntegrationHarness {
  app: App;
  tdb: TestDatabase;
  apple: AppleStub;
  clock: FakeClock;
  storage: MemoryObjectStorage;
  boss: FakeBoss;
  config: AppConfig;
  /** Captured pino lines when `captureLogs` was requested. */
  logLines: string[];
  close(): Promise<void>;
}

export interface HarnessOptions {
  /** Partial config merged over `testConfig` (e.g. a low `rateLimit.authPerMin`). */
  config?: Partial<AppConfig>;
  /** Extra `buildApp` options. */
  app?: Partial<BuildAppOptions>;
  /** Route pino through an in-memory stream so tests can assert what was logged. */
  captureLogs?: boolean;
  /** Start of the fake clock (default 2026-09-07T10:00:00Z). */
  now?: string;
}

/**
 * Everything an integration suite needs: a throwaway database with migrations applied, an
 * in-process Apple JWKS stub, a fake clock, in-memory storage, a recording pg-boss fake and the
 * app built on top of them. Call `close()` in `afterAll`.
 */
export async function createIntegrationHarness(
  opts: HarnessOptions = {},
): Promise<IntegrationHarness> {
  const adminUrl = inject('adminDatabaseUrl');
  if (!adminUrl) throw new Error('adminDatabaseUrl was not provided by global setup');
  const tdb = await createTestDatabase(adminUrl);
  const apple = await AppleStub.create();
  await apple.listen();
  const clock = new FakeClock(opts.now);
  const storage = new MemoryObjectStorage(clock);
  const boss = fakeBoss();
  const logLines: string[] = [];

  const base = testConfig({ databaseUrl: tdb.url, jobsEnabled: true });
  const config: AppConfig = {
    ...base,
    apple: { ...base.apple, jwksUrl: apple.jwksUrl },
    ...opts.config,
  };

  const app = await buildApp({
    config,
    logger: opts.captureLogs
      ? {
          level: 'info',
          stream: {
            write(line: string) {
              logLines.push(line);
            },
          },
        }
      : false,
    pool: tdb.pool,
    // No start-up reckoning catch-up: suites seed and reckon their own weeks explicitly.
    jobs: { boss: asJobBoss(boss), catchUp: false },
    storage,
    clock,
    ...opts.app,
  });
  await app.ready();

  return {
    app,
    tdb,
    apple,
    clock,
    storage,
    boss,
    config,
    logLines,
    async close() {
      await app.close();
      await apple.close();
      await tdb.close();
    },
  };
}
