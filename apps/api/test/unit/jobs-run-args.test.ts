import { describe, expect, it } from 'vitest';
import { RUNNABLE_JOBS, isRunArgsError, parseRunArgs } from '../../src/jobs/run-args.js';

describe('job runner arguments (research.md R16, FR-015)', () => {
  it('defaults to reckoning.weekly with no flags', () => {
    expect(parseRunArgs([])).toEqual({ jobName: 'reckoning.weekly', dryRun: false, repair: false });
    expect(parseRunArgs(['reckoning.weekly'])).toEqual({
      jobName: 'reckoning.weekly',
      dryRun: false,
      repair: false,
    });
  });

  it('parses --week and --dry-run, dropping the pnpm "--" separator', () => {
    expect(parseRunArgs(['reckoning.weekly', '--', '--week', '2026-W37', '--dry-run'])).toEqual({
      jobName: 'reckoning.weekly',
      week: '2026-W37',
      dryRun: true,
      repair: false,
    });
    expect(parseRunArgs(['--week=2026-W36'])).toMatchObject({ week: '2026-W36', dryRun: false });
  });

  it('parses --repair for reckoning.consistency and --user for the account jobs', () => {
    expect(parseRunArgs(['reckoning.consistency', '--', '--repair'])).toEqual({
      jobName: 'reckoning.consistency',
      dryRun: false,
      repair: true,
    });
    expect(parseRunArgs(['reckoning.consistency'])).toMatchObject({ repair: false });
    expect(parseRunArgs(['account.purge', '--', '--user', 'u1'])).toMatchObject({
      jobName: 'account.purge',
      user: 'u1',
    });
    expect(parseRunArgs(['account.export', '--user', 'u2'])).toMatchObject({ user: 'u2' });
  });

  it('answers exit code 2 for unknown jobs, unknown flags and bad combinations', () => {
    const cases: [string[], RegExp][] = [
      [['nope'], /unknown job/],
      [['reckoning.weekly', '--bogus'], /Unknown option/],
      [['reckoning.weekly', 'extra'], /unexpected argument/],
      [['account.purge'], /needs --user/],
      [['reckoning.weekly', '--week', '2026-37'], /YYYY-Www/],
      [['walk.autofinish', '--week', '2026-W37'], /apply to reckoning.weekly only/],
      [['walk.autofinish', '--dry-run'], /apply to reckoning.weekly only/],
      [['reckoning.weekly', '--repair'], /applies to reckoning.consistency only/],
    ];
    for (const [argv, message] of cases) {
      const result = parseRunArgs(argv);
      expect(isRunArgsError(result), argv.join(' ')).toBe(true);
      if (isRunArgsError(result)) {
        expect(result.exitCode).toBe(2);
        expect(result.message).toMatch(message);
      }
    }
  });

  it('lists every runnable job', () => {
    expect(RUNNABLE_JOBS).toEqual([
      'reckoning.weekly',
      'reckoning.consistency',
      'walk.autofinish',
      'samples.purge',
      'account.purge',
      'account.export',
    ]);
  });
});
