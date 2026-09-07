import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/client.js';
import {
  EXPORT_SECTIONS,
  EXPORT_VERSION,
  ExportBundleSchema,
  buildExportBundle,
  validateExportSections,
  type ExportSection,
} from '../../src/modules/me/export-sections.js';

const noDb = { db: null as unknown as Db, refreshTtlDays: 60 };

const SAMPLE_SECTIONS: ExportSection[] = [
  {
    name: 'account',
    run: () =>
      Promise.resolve({
        id: '5b3f4e6c-2d1a-4c8b-9e7f-0a1b2c3d4e5f',
        appleUserId: '001234.abcdef.5678',
        email: 'u@privaterelay.appleid.com',
        displayName: 'Tadas',
        factionId: 2,
        factionChangedAt: null,
        xp: 0,
        level: 1,
        role: 'player',
        createdAt: '2026-09-07T10:00:00.000Z',
        lastSeenAt: '2026-09-07T10:00:00.000Z',
        deletedAt: null,
      }),
  },
  {
    name: 'factions',
    run: () =>
      Promise.resolve([
        { id: 1, slug: 'owls', name: 'Owls' },
        { id: 2, slug: 'foxes', name: 'Foxes' },
        { id: 3, slug: 'deer', name: 'Deer' },
      ]),
  },
  {
    name: 'sessions',
    run: () =>
      Promise.resolve([
        {
          issuedAt: '2026-09-07T10:00:00.000Z',
          expiresAt: '2026-11-06T10:00:00.000Z',
          revokedAt: null,
        },
      ]),
  },
];

describe('export sections', () => {
  it('registers account, factions and sessions with unique names', () => {
    expect(EXPORT_SECTIONS.map((section) => section.name)).toEqual([
      'account',
      'factions',
      'sessions',
    ]);
    expect(() => validateExportSections()).not.toThrow();
  });

  it('rejects duplicate, reserved and non-camelCase names', () => {
    const run = () => Promise.resolve(null);
    expect(() =>
      validateExportSections([
        { name: 'walks', run },
        { name: 'walks', run },
      ]),
    ).toThrow(/duplicate export section "walks"/);
    expect(() => validateExportSections([{ name: 'generatedAt', run }])).toThrow(/collides/);
    expect(() => validateExportSections([{ name: 'Walk Data', run }])).toThrow(/camelCase/);
  });

  it('builds a bundle that validates against the §4 schema', async () => {
    const generatedAt = new Date('2026-09-07T10:00:00.000Z');
    const bundle = await buildExportBundle(noDb, 'u', generatedAt, SAMPLE_SECTIONS);
    expect(Object.keys(bundle)).toEqual([
      'exportVersion',
      'generatedAt',
      'account',
      'factions',
      'sessions',
    ]);
    expect(bundle.exportVersion).toBe(EXPORT_VERSION);
    expect(bundle.generatedAt).toBe('2026-09-07T10:00:00.000Z');
    const issues = [...Value.Errors(ExportBundleSchema, bundle)];
    expect(issues, JSON.stringify(issues)).toEqual([]);
    expect(Value.Check(ExportBundleSchema, bundle)).toBe(true);
  });

  it('lets later features append sections after the 002 ones', async () => {
    const extended = [...SAMPLE_SECTIONS, { name: 'walks', run: () => Promise.resolve([]) }];
    const bundle = await buildExportBundle(noDb, 'u', new Date(), extended);
    expect(bundle).toHaveProperty('walks', []);
    expect(Value.Check(ExportBundleSchema, bundle)).toBe(true);
  });
});
