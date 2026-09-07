import { execFileSync } from 'node:child_process';

/**
 * Test database resolution (specs/001-repo-foundations/research.md R7), in order:
 *   1. SKIP_DB_TESTS=1  -> integration suites are registered with describe.skip and say why;
 *   2. DATABASE_URL set -> used as the admin connection (make test, CI); every suite creates a
 *                          throwaway database from it and drops it afterwards;
 *   3. otherwise        -> Testcontainers starts nature-postgres:16-3.4-h3 if the image exists
 *                          locally, else postgis/postgis:16-3.4 (h3-pg is optional).
 * This module must not import vitest: it is also loaded by the global setup, which runs outside
 * the test worker (see test/helpers/global-setup.ts).
 */
export const NATURE_IMAGE = 'nature-postgres:16-3.4-h3';
export const FALLBACK_IMAGE = 'postgis/postgis:16-3.4';

export type DbTestMode =
  { kind: 'skip'; reason: string } | { kind: 'url'; adminUrl: string } | { kind: 'container' };

export function resolveDbTestMode(
  env: Record<string, string | undefined> = process.env,
): DbTestMode {
  const skip = env.SKIP_DB_TESTS;
  if (skip === '1' || skip === 'true') {
    return { kind: 'skip', reason: `SKIP_DB_TESTS=${skip} (no Postgres in this environment)` };
  }
  if (env.DATABASE_URL) return { kind: 'url', adminUrl: env.DATABASE_URL };
  return { kind: 'container' };
}

/** The locally built image when present, else the plain PostGIS image. */
export function pickContainerImage(): string {
  try {
    execFileSync('docker', ['image', 'inspect', NATURE_IMAGE], { stdio: 'ignore' });
    return NATURE_IMAGE;
  } catch {
    return FALLBACK_IMAGE;
  }
}
