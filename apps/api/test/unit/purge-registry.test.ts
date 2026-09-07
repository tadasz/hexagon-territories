import { describe, expect, it } from 'vitest';
import {
  PURGE_STEPS,
  purgeCoveredTables,
  validatePurgeSteps,
  type PurgeStep,
} from '../../src/modules/me/purge.js';

const noop = () => Promise.resolve(0);

describe('purge registry', () => {
  it('registers the 002 steps and the 003 walks step in order with users last', () => {
    expect(() => validatePurgeSteps()).not.toThrow();
    expect(PURGE_STEPS.map((step) => step.name)).toEqual([
      'exports',
      'refresh_tokens',
      'devices',
      'walks',
      'captures',
      'leaderboard_snapshots',
      'users',
    ]);
    expect(PURGE_STEPS[PURGE_STEPS.length - 1]?.tables).toEqual(['users']);
    expect(purgeCoveredTables()).toContain('account_exports');
    // feature 003 (modules/walks/purge.ts): the four tables with a users FK that walks write
    const walks = PURGE_STEPS.find((step) => step.name === 'walks');
    expect(walks?.tables).toEqual([
      'points_ledger',
      'anti_cheat_flags',
      'hex_week_contribution',
      'walk_sessions',
    ]);
  });

  it('rejects duplicate names', () => {
    const steps: PurgeStep[] = [
      { name: 'a', tables: ['t1'], run: noop },
      { name: 'a', tables: ['t2'], run: noop },
      { name: 'users', tables: ['users'], run: noop },
    ];
    expect(() => validatePurgeSteps(steps)).toThrow(/duplicate purge step "a"/);
  });

  it('requires the users step to be last and unique', () => {
    expect(() =>
      validatePurgeSteps([
        { name: 'users', tables: ['users'], run: noop },
        { name: 'later', tables: ['t'], run: noop },
      ]),
    ).toThrow(/last purge step must delete the users row/);
    expect(() =>
      validatePurgeSteps([
        { name: 'first', tables: ['users'], run: noop },
        { name: 'users', tables: ['users'], run: noop },
      ]),
    ).toThrow(/only the last purge step may touch users/);
    expect(() => validatePurgeSteps([])).toThrow(/last purge step/);
  });

  it('rejects steps that cover no table', () => {
    expect(() =>
      validatePurgeSteps([
        { name: 'empty', tables: [], run: noop },
        { name: 'users', tables: ['users'], run: noop },
      ]),
    ).toThrow(/lists no tables/);
  });
});
