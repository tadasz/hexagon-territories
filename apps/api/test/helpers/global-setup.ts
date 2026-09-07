import type { TestProject } from 'vitest/node';
import { pickContainerImage, resolveDbTestMode } from './db-mode.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Admin connection string for integration suites, or null when they are skipped. */
    adminDatabaseUrl: string | null;
  }
}

/**
 * Runs once per `vitest` invocation for the integration project: resolves where Postgres comes
 * from (see test/helpers/db.ts) and, in container mode, starts it with Testcontainers.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const mode = resolveDbTestMode();

  if (mode.kind === 'skip') {
    console.warn(`integration tests skipped: ${mode.reason}`);
    project.provide('adminDatabaseUrl', null);
    return async () => {};
  }

  if (mode.kind === 'url') {
    console.info('integration tests: using DATABASE_URL');
    project.provide('adminDatabaseUrl', mode.adminUrl);
    return async () => {};
  }

  const image = pickContainerImage();
  console.info(`integration tests: starting ${image} with Testcontainers`);
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  const container = await new PostgreSqlContainer(image)
    .withDatabase('nature')
    .withUsername('nature')
    .withPassword('nature')
    .start();
  project.provide('adminDatabaseUrl', container.getConnectionUri());
  return async () => {
    await container.stop();
  };
}
