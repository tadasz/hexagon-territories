/**
 * Fixture loader shared by every TypeScript test suite.
 *
 * Resolution order for the directory: explicit `options.dir` → `FIXTURES_DIR` env → this
 * package's `fixtures/` directory. Files are validated against `src/schema.ts`; any problem
 * throws a {@link FixtureError} whose message names the file and the first failing JSON path.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Value } from '@sinclair/typebox/value';
import { FIXTURE_SCHEMAS, type FixtureName, type FixtureOf } from './schema.js';

export class FixtureError extends Error {
  override readonly name = 'FixtureError';
  constructor(
    /** Absolute path of the offending file. */
    readonly filePath: string,
    /** JSON pointer of the first invalid value (`""` for parse errors). */
    readonly jsonPath: string,
    detail: string,
  ) {
    super(`${filePath}: ${detail}`);
  }
}

/** Absolute path of this package's committed `fixtures/` directory. */
export function defaultFixturesDir(): string {
  return fileURLToPath(new URL('../fixtures/', import.meta.url));
}

/** Directory the loader will read from, honouring `FIXTURES_DIR`. */
export function fixturesDir(options: { dir?: string } = {}): string {
  const env = process.env['FIXTURES_DIR'];
  return resolve(options.dir ?? (env && env.length > 0 ? env : defaultFixturesDir()));
}

/** Absolute path of `<name>.json` in the resolved fixtures directory. */
export function fixturePath(name: FixtureName, options: { dir?: string } = {}): string {
  return join(fixturesDir(options), `${name}.json`);
}

/**
 * Read, parse and validate one fixture file.
 * @throws FixtureError naming the file and the first failing JSON path
 */
export function loadFixture<N extends FixtureName>(
  name: N,
  options: { dir?: string } = {},
): FixtureOf<N> {
  const filePath = fixturePath(name, options);
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new FixtureError(filePath, '', `cannot read fixture: ${errorMessage(err)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new FixtureError(filePath, '', `invalid JSON: ${errorMessage(err)}`);
  }
  const schema = FIXTURE_SCHEMAS[name];
  if (!Value.Check(schema, json)) {
    const first = Value.Errors(schema, json).First();
    const path = first?.path ?? '';
    const message = first?.message ?? 'schema mismatch';
    throw new FixtureError(filePath, path, `invalid fixture at ${path || '/'}: ${message}`);
  }
  return json;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
