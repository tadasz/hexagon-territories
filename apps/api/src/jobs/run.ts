import pino from 'pino';
import { loadConfig } from '../config.js';
import { createPool, pingDatabase } from '../db/client.js';
import { RECKONING_WEEKLY, runReckoningWeekly } from './reckoning-weekly.js';

/**
 * Manual job runner: `pnpm --filter @nature/api job:reckoning` runs the reckoning handler once,
 * in-process, against DATABASE_URL (the same function pg-boss invokes on schedule). Exits 0 on
 * success, 1 on failure, 2 for an unknown job name.
 */
const JOBS = {
  [RECKONING_WEEKLY]: runReckoningWeekly,
} as const;

const jobName = process.argv[2] ?? RECKONING_WEEKLY;
const config = loadConfig();
const log = pino({ level: config.logLevel });

if (!(jobName in JOBS)) {
  log.error({ jobName, known: Object.keys(JOBS) }, 'unknown job');
  process.exit(2);
}

const pool = createPool(config.databaseUrl);
try {
  await pingDatabase(pool, 5_000);
  const result = await JOBS[jobName as keyof typeof JOBS](log);
  log.info({ jobName, ...result }, 'job finished');
} catch (err) {
  log.error({ err, jobName }, 'job failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
