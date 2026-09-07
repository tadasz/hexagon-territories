import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

/** Repository root (this file lives in packages/api-schema/scripts). */
export const REPO_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
export const SNAPSHOT_PATH = resolve(REPO_ROOT, 'packages/api-schema/openapi.json');
/** The iOS package keeps a copy (apps/ios/scripts/sync-openapi.sh); it must equal the snapshot. */
export const IOS_COPY_PATH = resolve(
  REPO_ROOT,
  'apps/ios/Packages/APIClient/Sources/APIClient/openapi.json',
);
export const SNAPSHOT_COMMAND = 'pnpm --filter @nature/api-schema snapshot';

/**
 * Runs the API's `openapi:print` script (boots the app without a database, prints the generated
 * document) and returns the document formatted with the repository's Prettier settings so the
 * committed file passes `prettier --check .`.
 */
export async function generateOpenApiSnapshot(): Promise<string> {
  const stdout = execFileSync('pnpm', ['--silent', '--filter', '@nature/api', 'openapi:print'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('openapi:print produced no JSON document');
  const json = stdout.slice(start, end + 1);
  JSON.parse(json); // fail early on a broken document
  const options = (await prettier.resolveConfig(SNAPSHOT_PATH)) ?? {};
  return prettier.format(json, { ...options, parser: 'json', filepath: SNAPSHOT_PATH });
}
