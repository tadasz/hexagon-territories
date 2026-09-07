import { parseArgs } from 'node:util';
import { ACCOUNT_EXPORT } from './account-export.js';
import { ACCOUNT_PURGE } from './account-purge.js';
import { RECKONING_CONSISTENCY } from './reckoning-consistency.js';
import { RECKONING_WEEKLY } from './reckoning-weekly.js';
import { SAMPLES_PURGE } from './samples-purge.js';
import { WALK_AUTOFINISH } from './walk-autofinish.js';

/** Jobs the manual runner (`src/jobs/run.ts`) can execute in-process. */
export const RUNNABLE_JOBS = [
  RECKONING_WEEKLY,
  RECKONING_CONSISTENCY,
  WALK_AUTOFINISH,
  SAMPLES_PURGE,
  ACCOUNT_PURGE,
  ACCOUNT_EXPORT,
] as const;
export type RunnableJob = (typeof RUNNABLE_JOBS)[number];

export interface RunArgs {
  jobName: RunnableJob;
  /** `--user <id>` (account.purge, account.export). */
  user?: string;
  /** `--week YYYY-Www` (reckoning.weekly). */
  week?: string;
  /** `--dry-run` (reckoning.weekly). */
  dryRun: boolean;
  /** `--repair` (reckoning.consistency). */
  repair: boolean;
}

export interface RunArgsError {
  exitCode: 2;
  message: string;
}

const WEEK_ID = /^\d{4}-W\d{2}$/;

/**
 * Parses `argv` (without `node` and the script) for the runner: `<job> [--user id] [--week id]
 * [--dry-run] [--repair]`. `pnpm run job:x -- --flag` forwards the `--` separator, which is
 * dropped. Unknown flags, a bad week id or a missing `--user` answer exit code 2.
 */
export function parseRunArgs(argv: readonly string[]): RunArgs | RunArgsError {
  let parsed: ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>;
  try {
    parsed = parseArgs({
      args: argv.filter((arg) => arg !== '--'),
      allowPositionals: true,
      options: OPTIONS,
    });
  } catch (err) {
    return { exitCode: 2, message: err instanceof Error ? err.message : String(err) };
  }
  const { values, positionals } = parsed;
  const jobName = positionals[0] ?? RECKONING_WEEKLY;
  if (!(RUNNABLE_JOBS as readonly string[]).includes(jobName)) {
    return {
      exitCode: 2,
      message: `unknown job "${jobName}" (known: ${RUNNABLE_JOBS.join(', ')})`,
    };
  }
  if (positionals.length > 1) {
    return { exitCode: 2, message: `unexpected argument "${positionals[1] ?? ''}"` };
  }
  if ((jobName === ACCOUNT_PURGE || jobName === ACCOUNT_EXPORT) && !values.user) {
    return { exitCode: 2, message: `${jobName} needs --user <id>` };
  }
  if (values.week !== undefined && !WEEK_ID.test(values.week)) {
    return { exitCode: 2, message: `--week must be YYYY-Www, got "${values.week}"` };
  }
  if ((values.week !== undefined || values['dry-run']) && jobName !== RECKONING_WEEKLY) {
    return { exitCode: 2, message: `--week and --dry-run apply to ${RECKONING_WEEKLY} only` };
  }
  if (values.repair && jobName !== RECKONING_CONSISTENCY) {
    return { exitCode: 2, message: `--repair applies to ${RECKONING_CONSISTENCY} only` };
  }
  return {
    jobName: jobName as RunnableJob,
    ...(values.user !== undefined ? { user: values.user } : {}),
    ...(values.week !== undefined ? { week: values.week } : {}),
    dryRun: values['dry-run'] === true,
    repair: values.repair === true,
  };
}

const OPTIONS = {
  user: { type: 'string' },
  week: { type: 'string' },
  'dry-run': { type: 'boolean' },
  repair: { type: 'boolean' },
} as const;

export function isRunArgsError(value: RunArgs | RunArgsError): value is RunArgsError {
  return 'exitCode' in value;
}
