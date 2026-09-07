import { and, eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/client.js';
import { accountExports } from '../db/schema/index.js';
import { ERROR_CODES } from '../errors.js';
import type { ObjectStorage } from '../lib/storage.js';
import { addDays, type Clock } from '../lib/time.js';
import { buildExportBundle } from '../modules/me/export-sections.js';

export const ACCOUNT_EXPORT = 'account.export';

/** pg-boss payload of data-model.md §5. */
export interface AccountExportJobData {
  exportId: string;
  userId: string;
}

export interface AccountExportDeps {
  db: Db;
  storage: ObjectStorage;
  clock: Clock;
  log: FastifyBaseLogger;
  exportTtlDays: number;
  refreshTtlDays: number;
}

export interface AccountExportResult {
  exportId: string;
  status: 'ready' | 'failed' | 'skipped';
  objectKey?: string;
}

export interface AccountExportRunOptions {
  /**
   * True on the last pg-boss attempt (or for a manual run): a failure is then recorded on the
   * row as `failed`. Earlier attempts leave the row `pending` and rethrow so pg-boss retries.
   */
  finalAttempt: boolean;
}

/** Send options for `boss.send(ACCOUNT_EXPORT, …)` (research.md R8). */
export function accountExportSendOptions(exportId: string) {
  return { singletonKey: exportId, retryLimit: 3 };
}

export function exportObjectKey(userId: string, exportId: string): string {
  return `exports/${userId}/${exportId}.json`;
}

/**
 * Builds the JSON bundle for a pending export, writes it to object storage and marks the row
 * `ready` with `expires_at = completed_at + EXPORT_TTL_DAYS`. Any error is recorded as a short
 * machine message without personal data.
 */
export async function runAccountExport(
  deps: AccountExportDeps,
  data: AccountExportJobData,
  opts: AccountExportRunOptions = { finalAttempt: true },
): Promise<AccountExportResult> {
  const { exportId, userId } = data;
  const [row] = await deps.db
    .select({ status: accountExports.status, userId: accountExports.userId })
    .from(accountExports)
    .where(and(eq(accountExports.id, exportId), eq(accountExports.userId, userId)))
    .limit(1);
  if (!row || row.status !== 'pending') {
    deps.log.info({ exportId, status: row?.status ?? 'missing' }, 'account.export: nothing to do');
    return { exportId, status: 'skipped' };
  }

  const objectKey = exportObjectKey(userId, exportId);
  try {
    const generatedAt = deps.clock.now();
    const bundle = await buildExportBundle(
      { db: deps.db, refreshTtlDays: deps.refreshTtlDays },
      userId,
      generatedAt,
    );
    await deps.storage.putObject(objectKey, JSON.stringify(bundle, null, 2), 'application/json');
    const completedAt = deps.clock.now();
    await deps.db
      .update(accountExports)
      .set({
        status: 'ready',
        objectKey,
        completedAt,
        expiresAt: addDays(completedAt, deps.exportTtlDays),
        error: null,
      })
      .where(eq(accountExports.id, exportId));
    deps.log.info({ exportId, userId, objectKey }, 'account.export: ready');
    return { exportId, status: 'ready', objectKey };
  } catch (err) {
    const name = err instanceof Error ? err.name : 'Error';
    deps.log.error(
      { err, exportId, userId, finalAttempt: opts.finalAttempt },
      'account.export: failed',
    );
    if (!opts.finalAttempt) throw err;
    await deps.db
      .update(accountExports)
      .set({
        status: 'failed',
        completedAt: deps.clock.now(),
        error: `${ERROR_CODES.EXPORT_FAILED}: ${name}`,
      })
      .where(eq(accountExports.id, exportId));
    return { exportId, status: 'failed' };
  }
}
