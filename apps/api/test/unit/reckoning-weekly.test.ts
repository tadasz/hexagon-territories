import { describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { App } from '../../src/app.js';
import {
  RECKONING_CRON,
  RECKONING_WEEKLY,
  registerReckoningWeekly,
  runReckoningWeekly,
  type JobScheduler,
} from '../../src/jobs/reckoning-weekly.js';
import type { JobBoss } from '../../src/plugins/jobs.js';
import { buildUnitApp, testConfig } from '../helpers/app.js';

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
    work: vi.fn((name: string, handler: Handler) => {
      handlers.set(name, handler);
      return Promise.resolve(`worker-${name}`);
    }),
    handlers,
  };
  return boss;
}

describe('reckoning.weekly', () => {
  it('uses the constant from docs/territory-rules.md (Monday 00:00 UTC)', () => {
    expect(RECKONING_WEEKLY).toBe('reckoning.weekly');
    expect(RECKONING_CRON).toBe('0 0 * * 1');
  });

  it('creates the queue, schedules it in UTC and attaches a worker', async () => {
    const boss = fakeBoss();
    const log = fakeLogger();
    await registerReckoningWeekly(boss as unknown as JobScheduler, log);

    expect(boss.createQueue).toHaveBeenCalledWith('reckoning.weekly');
    expect(boss.schedule).toHaveBeenCalledWith('reckoning.weekly', '0 0 * * 1', {}, { tz: 'UTC' });
    expect(boss.work).toHaveBeenCalledWith('reckoning.weekly', expect.any(Function));
    expect(log.info).toHaveBeenCalledWith('reckoning.weekly scheduled (0 0 * * 1 UTC)');
  });

  it('logs "no work" when the worker runs and when invoked directly', async () => {
    const boss = fakeBoss();
    const log = fakeLogger();
    await registerReckoningWeekly(boss as unknown as JobScheduler, log);
    const handler = boss.handlers.get('reckoning.weekly');
    expect(handler).toBeDefined();
    await handler?.([{ id: 'job-1', name: 'reckoning.weekly', data: {} }]);
    expect(log.info).toHaveBeenCalledWith({ weekId: null }, 'reckoning.weekly: no work');

    const direct = fakeLogger();
    await expect(runReckoningWeekly(direct, { weekId: '2026-W36' })).resolves.toEqual({
      weekId: '2026-W36',
      hexesProcessed: 0,
      flips: 0,
    });
    expect(direct.info).toHaveBeenCalledWith({ weekId: '2026-W36' }, 'reckoning.weekly: no work');
  });
});

describe('jobs plugin', () => {
  let app: App | undefined;

  it('starts the injected boss on ready and stops it on close', async () => {
    const boss = fakeBoss();
    app = await buildUnitApp({ jobs: { boss: boss as unknown as JobBoss } });
    expect(boss.start).not.toHaveBeenCalled();
    await app.ready();
    expect(boss.start).toHaveBeenCalledTimes(1);
    expect(boss.schedule).toHaveBeenCalledWith('reckoning.weekly', '0 0 * * 1', {}, { tz: 'UTC' });
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
