import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Value } from '@sinclair/typebox/value';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FIXTURE_NAMES,
  FIXTURE_SCHEMAS,
  FixtureError,
  defaultFixturesDir,
  fixturePath,
  fixturesDir,
  loadFixture,
} from '../src/index.js';

describe('loadFixture: committed fixtures', () => {
  for (const name of FIXTURE_NAMES) {
    it(`${name}.json parses, validates and has the envelope`, () => {
      const fixture = loadFixture(name);
      expect(fixture.name).toBe(name);
      expect(fixture.description.length).toBeGreaterThan(0);
      expect(fixture.generator).toMatch(/^scripts\/generate\.ts#/);
      expect(fixture.version).toBeGreaterThanOrEqual(1);
      expect(fixture.seed).toBe(20260907);
      expect(Value.Check(FIXTURE_SCHEMAS[name], fixture)).toBe(true);
    });
  }

  it('case ids are unique within each file', () => {
    const ids = (xs: { id: string }[]) => xs.map((x) => x.id);
    const unique = (xs: string[]) => expect(new Set(xs).size).toBe(xs.length);
    unique(ids(loadFixture('latlng-to-cell').cases));
    unique(ids(loadFixture('zoom-resolution').cases));
    unique(ids(loadFixture('walk-paths').cases));
    const reck = loadFixture('reckoning-weeks');
    unique(ids(reck.cells));
    unique(ids(reck.parentCases));
  });

  it('has the sizes promised by data-model.md §1', () => {
    expect(loadFixture('latlng-to-cell').cases).toHaveLength(200);
    expect(loadFixture('zoom-resolution').cases).toHaveLength(23);
    expect(loadFixture('walk-paths').cases.map((c) => c.id)).toEqual([
      'straight-line',
      'edge-hugging',
      'loop-inside-one-cell',
      'noisy-zigzag',
      'teleport',
      'car-speed',
    ]);
    const reck = loadFixture('reckoning-weeks');
    expect(reck.weeks).toEqual(['2026-W35', '2026-W36', '2026-W37']);
    expect(reck.cells.length).toBeGreaterThanOrEqual(8);
    expect(reck.parentCases.length).toBeGreaterThanOrEqual(5);
    for (const cell of reck.cells) {
      expect(cell.weeks.map((w) => w.weekId)).toEqual(reck.weeks);
    }
  });
});

describe('loadFixture: directory resolution', () => {
  it('defaults to the package fixtures/ directory', () => {
    expect(fixturesDir()).toBe(defaultFixturesDir().replace(/\/$/, ''));
    expect(fixturePath('walk-paths')).toBe(join(fixturesDir(), 'walk-paths.json'));
  });

  it('honours FIXTURES_DIR and an explicit dir', () => {
    const prev = process.env['FIXTURES_DIR'];
    process.env['FIXTURES_DIR'] = '/some/where';
    try {
      expect(fixturesDir()).toBe('/some/where');
      expect(fixturesDir({ dir: '/explicit' })).toBe('/explicit');
    } finally {
      if (prev === undefined) delete process.env['FIXTURES_DIR'];
      else process.env['FIXTURES_DIR'] = prev;
    }
  });
});

describe('loadFixture: malformed files', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'h3-fixtures-'));
    writeFileSync(join(dir, 'walk-paths.json'), '{');
    const zoom = loadFixture('zoom-resolution');
    const broken = structuredClone(zoom) as unknown as {
      cases: { expected: { resolution: unknown } }[];
    };
    if (broken.cases[3]) broken.cases[3].expected.resolution = 'seven';
    writeFileSync(join(dir, 'zoom-resolution.json'), JSON.stringify(broken));
    writeFileSync(
      join(dir, 'latlng-to-cell.json'),
      JSON.stringify({ ...loadFixture('latlng-to-cell'), extra: 1 }),
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('names the file for a syntactically broken file', () => {
    const file = join(dir, 'walk-paths.json');
    expect(() => loadFixture('walk-paths', { dir })).toThrow(FixtureError);
    expect(() => loadFixture('walk-paths', { dir })).toThrow(file);
    expect(() => loadFixture('walk-paths', { dir })).toThrow(/invalid JSON/);
  });

  it('names the file and the first failing JSON path for a schema-invalid file', () => {
    const file = join(dir, 'zoom-resolution.json');
    let caught: unknown;
    try {
      loadFixture('zoom-resolution', { dir });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(FixtureError);
    const err = caught as FixtureError;
    expect(err.filePath).toBe(file);
    expect(err.jsonPath).toBe('/cases/3/expected/resolution');
    expect(err.message).toContain(file);
    expect(err.message).toContain('/cases/3/expected/resolution');
  });

  it('rejects unknown top-level properties', () => {
    expect(() => loadFixture('latlng-to-cell', { dir })).toThrow(/\/extra|unexpected|additional/i);
  });

  it('names a missing file', () => {
    expect(() => loadFixture('reckoning-weeks', { dir })).toThrow(
      join(dir, 'reckoning-weeks.json'),
    );
  });
});
