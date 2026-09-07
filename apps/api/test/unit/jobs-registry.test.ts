import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Db, Pool } from '../../src/db/client.js';
import { JOB_NAMES, registerJobs } from '../../src/jobs/index.js';
import { SAMPLES_PURGE_CRON } from '../../src/jobs/samples-purge.js';
import { WALK_AUTOFINISH_CRON } from '../../src/jobs/walk-autofinish.js';
import { MemoryObjectStorage } from '../../src/lib/storage.js';
import type * as RunModule from '../../src/modules/territory/reckoning/run.js';
import { asJobBoss, fakeBoss } from '../helpers/auth.js';
import { FakeClock } from '../helpers/clock.js';

const runDueReckonings = vi.hoisted(() => vi.fn());
vi.mock('../../src/modules/territory/reckoning/run.js', async (importOriginal) => {
  const actual = await importOriginal<typeof RunModule>();
  return { ...actual, runDueReckonings };
});

function fakeLogger() {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    silent: vi.fn(),
    level: 'info',
    child: vi.fn(),
  };
  log.child.mockReturnValue(log);
  return log as unknown as FastifyBaseLogger & typeof log;
}

const config = {
  account: { purgeGraceDays: 30, exportTtlDays: 7, exportUrlTtlS: 3600 },
  jwt: { secret: 'x'.repeat(32), accessTtlS: 900, refreshTtlDays: 60 },
  walks: {
    autofinishAfterH: 12,
    sampleRetentionDays: 30,
    xpDailyCap: 300,
    ingestBatchesPer15Min: 30,
    samplesPerDay: 8640,
  },
  territory: { batchSize: 1000, bboxMaxCells: 3000, consistencyCron: '15 3 * * *' },
};

describe('jobs registry', () => {
  it('creates the seven queues, schedules the four cron jobs and attaches every worker', async () => {
    const boss = fakeBoss();
    const log = fakeLogger();
    runDueReckonings.mockResolvedValueOnce([]);
    await registerJobs(asJobBoss(boss), {
      db: null as unknown as Db,
      pool: null as unknown as Pool,
      storage: new MemoryObjectStorage(),
      clock: new FakeClock(),
      log,
      config,
    });

    expect(JOB_NAMES).toEqual([
      'reckoning.weekly',
      'reckoning.consistency',
      'walk.autofinish',
      'samples.purge',
      'account.purge',
      'account.export',
      'push.send',
    ]);
    expect((boss.createQueue.mock.calls as unknown[][]).map((call) => call[0])).toEqual([
      ...JOB_NAMES,
    ]);
    // singleton keys dedupe queued jobs only under pg-boss 10's `short` policy
    expect(boss.createQueue).toHaveBeenCalledWith('reckoning.weekly', {
      name: 'reckoning.weekly',
      policy: 'short',
    });
    expect(boss.createQueue).toHaveBeenCalledWith('push.send', {
      name: 'push.send',
      policy: 'short',
    });
    expect(boss.schedule).toHaveBeenCalledTimes(4);
    expect(boss.schedule).toHaveBeenCalledWith(
      'reckoning.weekly',
      '0 0 * * 1',
      {},
      { tz: 'UTC', singletonKey: 'reckoning.weekly' },
    );
    expect(boss.schedule).toHaveBeenCalledWith(
      'reckoning.consistency',
      '15 3 * * *',
      {},
      { tz: 'UTC', singletonKey: 'reckoning.consistency' },
    );
    expect(WALK_AUTOFINISH_CRON).toBe('0 * * * *');
    expect(SAMPLES_PURGE_CRON).toBe('30 3 * * *');
    expect(boss.schedule).toHaveBeenCalledWith('walk.autofinish', '0 * * * *', {}, { tz: 'UTC' });
    expect(boss.schedule).toHaveBeenCalledWith('samples.purge', '30 3 * * *', {}, { tz: 'UTC' });
    // push.send has no worker in feature 004 (research.md R15)
    expect([...boss.handlers.keys()]).toEqual(JOB_NAMES.filter((name) => name !== 'push.send'));
    // The export worker asks pg-boss for retry metadata so it can mark the final failure.
    const exportWork = (boss.work.mock.calls as unknown[][]).find(
      (call) => call[0] === 'account.export',
    );
    expect(exportWork?.[1]).toEqual({ includeMetadata: true });
    expect(log.info).toHaveBeenCalledWith({ queues: JOB_NAMES }, 'jobs registered');
    // start-up catch-up ran once after registration (research.md R2)
    expect(runDueReckonings).toHaveBeenCalledTimes(1);
  });

  it('honours the consistency cron from config and skips the catch-up when told to', async () => {
    const boss = fakeBoss();
    runDueReckonings.mockClear();
    await registerJobs(asJobBoss(boss), {
      db: null as unknown as Db,
      pool: null as unknown as Pool,
      storage: new MemoryObjectStorage(),
      clock: new FakeClock(),
      log: fakeLogger(),
      config: { ...config, territory: { ...config.territory, consistencyCron: '0 4 * * *' } },
      catchUp: false,
    });
    expect(boss.schedule).toHaveBeenCalledWith(
      'reckoning.consistency',
      '0 4 * * *',
      {},
      { tz: 'UTC', singletonKey: 'reckoning.consistency' },
    );
    expect(runDueReckonings).not.toHaveBeenCalled();
  });

  it('logs a failed start-up catch-up instead of throwing (the API still boots)', async () => {
    const boss = fakeBoss();
    const log = fakeLogger();
    runDueReckonings.mockRejectedValueOnce(new Error('database on fire'));
    await expect(
      registerJobs(asJobBoss(boss), {
        db: null as unknown as Db,
        pool: null as unknown as Pool,
        storage: new MemoryObjectStorage(),
        clock: new FakeClock(),
        log,
        config,
      }),
    ).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(
      { err: expect.any(Error) as Error },
      'reckoning.weekly: start-up catch-up failed',
    );
  });
});
