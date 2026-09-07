import pino from 'pino';
import { loadConfig } from '../config.js';
import { createDb, createPool, pingDatabase } from '../db/client.js';
import { accountExports } from '../db/schema/index.js';
import { S3ObjectStorage } from '../lib/storage.js';
import { systemClock } from '../lib/time.js';
import { buildReckoningDeps } from '../modules/territory/reckoning/deps.js';
import { isReckoningError } from '../modules/territory/reckoning/errors.js';
import { runReckoning, type ReckoningRunResult } from '../modules/territory/reckoning/run.js';
import { ACCOUNT_EXPORT, runAccountExport } from './account-export.js';
import { ACCOUNT_PURGE, runAccountPurge } from './account-purge.js';
import { RECKONING_CONSISTENCY, runConsistency } from './reckoning-consistency.js';
import { runReckoningWeekly } from './reckoning-weekly.js';
import { isRunArgsError, parseRunArgs } from './run-args.js';
import { SAMPLES_PURGE, runSamplesPurge } from './samples-purge.js';
import { WALK_AUTOFINISH, runWalkAutofinish } from './walk-autofinish.js';

/**
 * Manual job runner, in-process against DATABASE_URL (the same handlers pg-boss invokes):
 *
 *   pnpm --filter @nature/api job:reckoning                          # every due week, in order
 *   pnpm --filter @nature/api job:reckoning -- --week 2026-W37       # exactly that week
 *   pnpm --filter @nature/api job:reckoning -- --week 2026-W37 --dry-run   # prints the flips, writes nothing
 *   pnpm --filter @nature/api job:consistency [-- --repair]          # parent drift report (repair on request)
 *   pnpm --filter @nature/api job:autofinish              # finishes walks active for > 12 h
 *   pnpm --filter @nature/api job:purge-samples           # drops sample partitions older than 30 days
 *   pnpm --filter @nature/api job:purge  -- --user <id>   # purges only when the grace period is over
 *   pnpm --filter @nature/api job:export -- --user <id>   # creates a pending export, builds it (real S3)
 *
 * Exits 0 on success, 1 on failure (a refused reckoning prints its code), 2 for bad arguments.
 * The reckoning runs without pg-boss here, so result pushes are skipped with a log line.
 */
const args = parseRunArgs(process.argv.slice(2));
const config = loadConfig();
const log = pino({ level: config.logLevel });

if (isRunArgsError(args)) {
  log.error({ message: args.message }, 'bad arguments');
  process.exit(args.exitCode);
}
const jobName = args.jobName;

function printFlips(result: ReckoningRunResult): void {
  for (const flip of result.flipsPreview) {
    process.stdout.write(`${flip.h3} ${String(flip.from ?? '-')}→${String(flip.to ?? '-')}\n`);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

const pool = createPool(config.databaseUrl);
try {
  await pingDatabase(pool, 5_000);
  const db = createDb(pool);
  const storage = new S3ObjectStorage({
    endpoint: config.s3.endpoint,
    publicEndpoint: config.s3.publicEndpoint,
    region: config.s3.region,
    bucket: config.s3.bucket,
    accessKey: config.s3.accessKey,
    secretKey: config.s3.secretKey,
  });

  let result: object;
  if (jobName === ACCOUNT_PURGE) {
    result = await runAccountPurge(
      { db, storage, clock: systemClock, log, graceDays: config.account.purgeGraceDays },
      { userId: args.user as string, deletedAt: '' },
    );
  } else if (jobName === ACCOUNT_EXPORT) {
    const [row] = await db
      .insert(accountExports)
      .values({ userId: args.user as string })
      .returning({ id: accountExports.id });
    result = await runAccountExport(
      {
        db,
        storage,
        clock: systemClock,
        log,
        exportTtlDays: config.account.exportTtlDays,
        refreshTtlDays: config.jwt.refreshTtlDays,
      },
      { exportId: row!.id, userId: args.user as string },
      { finalAttempt: true },
    );
  } else if (jobName === WALK_AUTOFINISH) {
    result = await runWalkAutofinish({
      db,
      clock: systemClock,
      log,
      afterH: config.walks.autofinishAfterH,
      xpDailyCap: config.walks.xpDailyCap,
    });
  } else if (jobName === SAMPLES_PURGE) {
    result = await runSamplesPurge({
      db,
      clock: systemClock,
      log,
      retentionDays: config.walks.sampleRetentionDays,
    });
  } else if (jobName === RECKONING_CONSISTENCY) {
    result = await runConsistency({ db, pool, clock: systemClock, log }, { repair: args.repair });
  } else {
    const deps = buildReckoningDeps({ db, pool, boss: null, clock: systemClock, log, config });
    if (args.week !== undefined) {
      const run = await runReckoning(deps, { weekId: args.week, dryRun: args.dryRun });
      if (args.dryRun) printFlips(run);
      else process.stdout.write(`${JSON.stringify(run)}\n`);
      result = run;
    } else {
      const runs = await runReckoningWeekly(deps);
      process.stdout.write(`${JSON.stringify(runs)}\n`);
      result = { weeks: runs.map((r) => r.weekId), flips: runs.reduce((s, r) => s + r.flips, 0) };
    }
  }
  log.info({ jobName, ...result }, 'job finished');
} catch (err) {
  if (isReckoningError(err)) {
    log.error({ jobName, code: err.code, message: err.message }, 'job refused');
  } else {
    log.error({ err, jobName }, 'job failed');
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}
