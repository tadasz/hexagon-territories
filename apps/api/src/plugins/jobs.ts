import fp from 'fastify-plugin';
import PgBoss from 'pg-boss';
import type { AppConfig } from '../config.js';
import { registerJobs, type JobRegistrar } from '../jobs/index.js';
import { systemClock, type Clock } from '../lib/time.js';

/** The slice of pg-boss the plugin and the routes drive; a fake with these members is enough for tests. */
export type JobBoss = JobRegistrar &
  Pick<PgBoss, 'start' | 'stop' | 'send'> & {
    on(event: 'error', handler: (error: Error) => void): unknown;
  };

export interface JobsPluginOptions {
  /** `JOBS_ENABLED !== 'false'`; when false the plugin only decorates `boss` with null. */
  enabled: boolean;
  /** Inject a boss (tests). Defaults to pg-boss 10 on the shared pool. */
  boss?: JobBoss;
  /** Postgres schema pg-boss owns. */
  schema?: string;
  /** Delay before retrying `boss.start()` after a failure (e.g. database down at boot). */
  retryMs?: number;
  /** Job dependencies beyond the Fastify decorators (`db`, `storage`, `log`). */
  clock?: Clock;
  config: Pick<AppConfig, 'account' | 'jwt' | 'walks'>;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** pg-boss instance, or null when jobs are disabled. */
    boss: JobBoss | null;
    /** True once pg-boss started and every job is registered. */
    jobsStarted: boolean;
  }
}

/**
 * Boots pg-boss on the shared `pg.Pool` (one connection budget) and registers every job through
 * `registerJobs`. A database that is down at boot does not crash the API: the start is retried
 * every `retryMs` and `/health` keeps reporting the outage.
 */
export const jobsPlugin = fp<JobsPluginOptions>(
  (fastify, opts, done) => {
    fastify.decorate('jobsStarted', false);
    if (!opts.enabled) {
      fastify.decorate('boss', null);
      fastify.log.info('jobs disabled (JOBS_ENABLED=false)');
      done();
      return;
    }

    const boss: JobBoss =
      opts.boss ??
      new PgBoss({
        db: { executeSql: (text, values) => fastify.pg.query(text, values) },
        schema: opts.schema ?? 'pgboss',
      });
    boss.on('error', (err) => fastify.log.error({ err }, 'pg-boss error'));
    fastify.decorate('boss', boss);

    const retryMs = opts.retryMs ?? 30_000;
    let closing = false;
    let retryTimer: NodeJS.Timeout | undefined;

    const start = async (): Promise<void> => {
      try {
        await boss.start();
        await registerJobs(boss, {
          db: fastify.db,
          storage: fastify.storage,
          clock: opts.clock ?? systemClock,
          log: fastify.log,
          config: opts.config,
        });
        fastify.jobsStarted = true;
        fastify.log.info('pg-boss started');
      } catch (err) {
        if (closing) return;
        fastify.log.error({ err, retryMs }, 'pg-boss failed to start; retrying');
        retryTimer = setTimeout(() => void start(), retryMs);
        retryTimer.unref();
      }
    };

    fastify.addHook('onReady', async () => {
      await start();
    });

    fastify.addHook('onClose', async () => {
      closing = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (fastify.jobsStarted) await boss.stop({ graceful: true, wait: true, timeout: 5_000 });
    });
    done();
  },
  { name: 'jobs', fastify: '5.x', dependencies: ['db', 'storage'] },
);
