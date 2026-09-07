import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/client.js';
import { users } from '../db/schema/index.js';
import type { ObjectStorage } from '../lib/storage.js';
import { addDays, type Clock } from '../lib/time.js';
import { purgeUser, type PurgeStepResult } from '../modules/me/purge.js';

export const ACCOUNT_PURGE = 'account.purge';

/** pg-boss payload of data-model.md §5. */
export interface AccountPurgeJobData {
  userId: string;
  /** ISO 8601; informational (the handler re-reads `users.deleted_at`). */
  deletedAt: string;
}

export interface AccountPurgeResult {
  userId: string;
  purged: boolean;
  /** Why nothing was purged, when `purged` is false. */
  reason?: 'not_found' | 'restored' | 'grace_period';
  steps: PurgeStepResult[];
}

export interface AccountPurgeDeps {
  db: Db;
  storage: ObjectStorage;
  clock: Clock;
  log: FastifyBaseLogger;
  graceDays: number;
}

/** Send options for `boss.send(ACCOUNT_PURGE, …)` (research.md R7). */
export function accountPurgeSendOptions(purgeAt: Date, userId: string) {
  return { startAfter: purgeAt, singletonKey: userId, retryLimit: 5, retryBackoff: true };
}

/**
 * Erases an account once its grace period is over (research.md R7). Idempotent and restore-safe:
 * it does nothing unless the user still exists with `deleted_at <= now - grace`, so a restored
 * account, a rerun after a crash and a manual early run are all harmless.
 */
export async function runAccountPurge(
  deps: AccountPurgeDeps,
  data: AccountPurgeJobData,
): Promise<AccountPurgeResult> {
  const { userId } = data;
  const [row] = await deps.db
    .select({ id: users.id, deletedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) {
    deps.log.info({ userId }, 'account.purge: user already gone');
    return { userId, purged: false, reason: 'not_found', steps: [] };
  }
  if (row.deletedAt === null) {
    deps.log.info({ userId }, 'account.purge: account was restored; nothing to do');
    return { userId, purged: false, reason: 'restored', steps: [] };
  }
  const cutoff = addDays(deps.clock.now(), -deps.graceDays);
  if (row.deletedAt.getTime() > cutoff.getTime()) {
    deps.log.info(
      {
        userId,
        deletedAt: row.deletedAt.toISOString(),
        purgeAt: addDays(row.deletedAt, deps.graceDays).toISOString(),
      },
      'account.purge: grace period not over',
    );
    return { userId, purged: false, reason: 'grace_period', steps: [] };
  }

  const outcome = await purgeUser(deps.db, deps.storage, userId);
  deps.log.info({ userId, steps: outcome.steps }, 'account.purge: purged');
  return { userId, purged: true, steps: outcome.steps };
}
