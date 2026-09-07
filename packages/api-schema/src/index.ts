import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Absolute path of the committed OpenAPI snapshot (`packages/api-schema/openapi.json`), the
 * document the iOS `APIClient` package is generated from (specs/002-auth-and-factions/research.md
 * R10). Regenerate with `pnpm --filter @nature/api-schema snapshot`; `pnpm --filter
 * @nature/api-schema test` fails while the snapshot is stale.
 */
export const OPENAPI_PATH: string = fileURLToPath(new URL('../openapi.json', import.meta.url));

/** Parses the snapshot; consumers read error codes from `components.schemas.Error`. */
export function readOpenApiDocument(): Record<string, unknown> {
  return JSON.parse(readFileSync(OPENAPI_PATH, 'utf8')) as Record<string, unknown>;
}
