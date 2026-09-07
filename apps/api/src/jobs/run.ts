import { parseArgs } from 'node:util';
import pino from 'pino';
import { loadConfig } from '../config.js';
import { createDb, createPool, pingDatabase } from '../db/client.js';
import { accountExports } from '../db/schema/index.js';
import { S3ObjectStorage } from '../lib/storage.js';
import { systemClock } from '../lib/time.js';
import { ACCOUNT_EXPORT, runAccountExport } from './account-export.js';
import { ACCOUNT_PURGE, runAccountPurge } from './account-purge.js';
import { RECKONING_WEEKLY, runReckoningWeekly } from './reckoning-weekly.js';

/**
 * Manual job runner, in-process against DATABASE_URL (the same handlers pg-boss invokes):
 *
 *   pnpm --filter @nature/api job:reckoning
 *   pnpm --filter @nature/api job:purge  -- --user <id>   # purges only when the grace period is over
 *   pnpm --filter @nature/api job:export -- --user <id>   # creates a pending export, builds it (real S3)
 *
 * Exits 0 on success, 1 on failure, 2 for an unknown job name or missing arguments.
 */
const JOB_NAMES = [RECKONING_WEEKLY, ACCOUNT_PURGE, ACCOUNT_EXPORT] as const;

const { values, positionals } = parseArgs({
  // `pnpm run job:purge -- --user <id>` forwards the `--` separator; drop it so `--user` is parsed.
  args: process.argv.slice(2).filter((arg) => arg !== '--'),
  allowPositionals: true,
  options: { user: { type: 'string' } },
});
const jobName = positionals[0] ?? RECKONING_WEEKLY;
const config = loadConfig();
const log = pino({ level: config.logLevel });

if (!(JOB_NAMES as readonly string[]).includes(jobName)) {
  log.error({ jobName, known: JOB_NAMES }, 'unknown job');
  process.exit(2);
}
if ((jobName === ACCOUNT_PURGE || jobName === ACCOUNT_EXPORT) && !values.user) {
  log.error({ jobName }, 'missing --user <id>');
  process.exit(2);
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
      { userId: values.user as string, deletedAt: '' },
    );
  } else if (jobName === ACCOUNT_EXPORT) {
    const [row] = await db
      .insert(accountExports)
      .values({ userId: values.user as string })
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
      { exportId: row!.id, userId: values.user as string },
      { finalAttempt: true },
    );
  } else {
    result = await runReckoningWeekly(log);
  }
  log.info({ jobName, ...result }, 'job finished');
} catch (err) {
  log.error({ err, jobName }, 'job failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
