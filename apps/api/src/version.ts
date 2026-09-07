import { readFileSync } from 'node:fs';

/**
 * The API package version, read from apps/api/package.json at startup (the file sits one level
 * above both `src/` and `dist/`, so the same relative URL works for tsx and the compiled build).
 */
export const API_VERSION: string = (() => {
  try {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
