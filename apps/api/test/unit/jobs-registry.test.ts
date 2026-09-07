import type { FastifyBaseLogger } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/db/client.js';
import { JOB_NAMES, registerJobs } from '../../src/jobs/index.js';
import { MemoryObjectStorage } from '../../src/lib/storage.js';
import { fakeBoss } from '../helpers/auth.js';
import { FakeClock } from '../helpers/clock.js';

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

describe('jobs registry', () => {
  it('creates the three queues, schedules only the reckoning and attaches every worker', async () => {
    const boss = fakeBoss();
    const log = fakeLogger();
    await registerJobs(boss, {
      db: null as unknown as Db,
      storage: new MemoryObjectStorage(),
      clock: new FakeClock(),
      log,
      config: {
        account: { purgeGraceDays: 30, exportTtlDays: 7, exportUrlTtlS: 3600 },
        jwt: { secret: 'x'.repeat(32), accessTtlS: 900, refreshTtlDays: 60 },
      },
    });

    expect(JOB_NAMES).toEqual(['reckoning.weekly', 'account.purge', 'account.export']);
    expect((boss.createQueue.mock.calls as unknown[][]).map((call) => call[0])).toEqual([
      'reckoning.weekly',
      'account.purge',
      'account.export',
    ]);
    expect(boss.schedule).toHaveBeenCalledTimes(1);
    expect(boss.schedule).toHaveBeenCalledWith('reckoning.weekly', '0 0 * * 1', {}, { tz: 'UTC' });
    expect([...boss.handlers.keys()]).toEqual([
      'reckoning.weekly',
      'account.purge',
      'account.export',
    ]);
    // The export worker asks pg-boss for retry metadata so it can mark the final failure.
    const exportWork = (boss.work.mock.calls as unknown[][]).find(
      (call) => call[0] === 'account.export',
    );
    expect(exportWork?.[1]).toEqual({ includeMetadata: true });
    expect(log.info).toHaveBeenCalledWith({ queues: JOB_NAMES }, 'jobs registered');
  });
});
