import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { App } from '../../src/app.js';
import type { Db, Pool } from '../../src/db/client.js';
import {
  RECKONING_CRON,
  RECKONING_WEEKLY,
  registerReckoningWeekly,
  runReckoningWeekly,
  type JobScheduler,
} from '../../src/jobs/reckoning-weekly.js';
import type * as RunModule from '../../src/modules/territory/reckoning/run.js';
import type { ReckoningDeps } from '../../src/modules/territory/reckoning/run.js';
import type { JobBoss } from '../../src/plugins/jobs.js';
import { buildUnitApp, testConfig } from '../helpers/app.js';
import { FakeClock } from '../helpers/clock.js';

const run = vi.hoisted(() => ({ runReckoning: vi.fn(), runDueReckonings: vi.fn() }));
vi.mock('../../src/modules/territory/reckoning/run.js', async (importOriginal) => {
  const actual = await importOriginal<typeof RunModule>();
  return { ...actual, ...run };
});

type Handler = (jobs: Array<{ id: string; name: string; data: unknown }>) => Promise<unknown>;

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

function fakeBoss() {
  const handlers = new Map<string, Handler>();
  const boss = {
    start: vi.fn(() => Promise.resolve(boss)),
    stop: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    createQueue: vi.fn(() => Promise.resolve()),
    schedule: vi.fn(() => Promise.resolve()),
    send: vi.fn(() => Promise.resolve('job-1')),
    work: vi.fn((name: string, handler: Handler) => {
      handlers.set(name, handler);
      return Promise.resolve(`worker-${name}`);
    }),
    handlers,
  };
  return boss;
}

function deps(log = fakeLogger()): ReckoningDeps {
  return {
    db: null as unknown as Db,
    pool: null as unknown as Pool,
    boss: null,
    clock: new FakeClock('2026-09-07T00:00:30.000Z'),
    log,
    batchSize: 1000,
  };
}

const done = (weekId: string) => ({ weekId, status: 'done', flips: 2 });

describe('reckoning.weekly', () => {
  it('uses the constant from docs/territory-rules.md (Monday 00:00 UTC)', () => {
    expect(RECKONING_WEEKLY).toBe('reckoning.weekly');
    expect(RECKONING_CRON).toBe('0 0 * * 1');
  });

  it('creates the queue, schedules it in UTC as a singleton and attaches a worker', async () => {
    const boss = fakeBoss();
    const log = fakeLogger();
    await registerReckoningWeekly(boss as unknown as JobScheduler, deps(log));

    expect(boss.createQueue).toHaveBeenCalledWith('reckoning.weekly', {
      name: 'reckoning.weekly',
      policy: 'short',
    });
    expect(boss.schedule).toHaveBeenCalledWith(
      'reckoning.weekly',
      '0 0 * * 1',
      {},
      { tz: 'UTC', singletonKey: 'reckoning.weekly' },
    );
    expect(boss.work).toHaveBeenCalledWith('reckoning.weekly', expect.any(Function));
    expect(log.info).toHaveBeenCalledWith('reckoning.weekly scheduled (0 0 * * 1 UTC)');
  });

  it('routes a job without a week to runDueReckonings and one with a week to runReckoning', async () => {
    run.runDueReckonings.mockResolvedValueOnce([done('2026-W35'), done('2026-W36')]);
    run.runReckoning.mockResolvedValueOnce(done('2026-W36'));
    const boss = fakeBoss();
    const log = fakeLogger();
    const d = deps(log);
    await registerReckoningWeekly(boss as unknown as JobScheduler, d);
    const handler = boss.handlers.get('reckoning.weekly');
    expect(handler).toBeDefined();
    await handler?.([{ id: 'job-1', name: 'reckoning.weekly', data: {} }]);
    expect(run.runDueReckonings).toHaveBeenCalledWith(
      expect.objectContaining({ batchSize: 1000 }),
      new Date('2026-09-07T00:00:30.000Z'),
    );
    expect(log.info).toHaveBeenCalledWith(
      { jobId: 'job-1', weeks: ['2026-W35', '2026-W36'], flips: 4 },
      'reckoning.weekly finished',
    );

    await expect(runReckoningWeekly(d, { weekId: '2026-W36' })).resolves.toEqual([
      done('2026-W36'),
    ]);
    expect(run.runReckoning).toHaveBeenCalledWith(d, { weekId: '2026-W36' });
  });
});

describe('jobs plugin', () => {
  let app: App | undefined;

  it('starts the injected boss on ready and stops it on close', async () => {
    run.runDueReckonings.mockResolvedValueOnce([]);
    const boss = fakeBoss();
    app = await buildUnitApp({ jobs: { boss: boss as unknown as JobBoss } });
    expect(boss.start).not.toHaveBeenCalled();
    await app.ready();
    expect(boss.start).toHaveBeenCalledTimes(1);
    expect(boss.schedule).toHaveBeenCalledWith(
      'reckoning.weekly',
      '0 0 * * 1',
      {},
      { tz: 'UTC', singletonKey: 'reckoning.weekly' },
    );
    expect(app.jobsStarted).toBe(true);
    await app.close();
    expect(boss.stop).toHaveBeenCalledWith({ graceful: true, wait: true, timeout: 5_000 });
    app = undefined;
  });

  it('does not crash the app when the boss cannot start', async () => {
    const boss = fakeBoss();
    boss.start.mockRejectedValueOnce(new Error('database down'));
    app = await buildUnitApp({ jobs: { boss: boss as unknown as JobBoss, retryMs: 60_000 } });
    await app.ready();
    expect(app.jobsStarted).toBe(false);
    const res = await app.inject({ url: '/health' });
    expect(res.statusCode).toBe(200);
    await app.close();
    expect(boss.stop).not.toHaveBeenCalled();
    app = undefined;
  });

  it('leaves boss null when jobs are disabled by config', async () => {
    app = await buildUnitApp({ config: testConfig({ jobsEnabled: false }), jobs: undefined });
    await app.ready();
    expect(app.boss).toBeNull();
    expect(app.jobsStarted).toBe(false);
    await app.close();
    app = undefined;
  });
});
