import { eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { accountExports } from '../../db/schema/index.js';
import type { ObjectStorage } from '../../lib/storage.js';

/** The transaction handle the steps run in. */
export type PurgeTx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * One erasure step of the `account.purge` job (research.md R7). `tables` lists the tables whose
 * rows keyed to the user this step removes (or anonymises); the FK-coverage test fails when a
 * table referencing `users` is neither `ON DELETE CASCADE` / `SET NULL` nor named by a step.
 * Later features register their own steps here instead of editing the job.
 */
export interface PurgeStep {
  name: string;
  tables: readonly string[];
  /** Returns the number of rows removed or anonymised. */
  run(tx: PurgeTx, userId: string): Promise<number>;
}

export interface PurgeStepResult {
  name: string;
  rows: number;
}

function deleteStep(name: string, table: string, column = 'user_id'): PurgeStep {
  return {
    name,
    tables: [table],
    run: (tx, userId) => runDelete(tx, table, column, userId),
  };
}

async function runDelete(tx: PurgeTx, table: string, column: string, userId: string) {
  const result = await tx.execute(
    sql`delete from ${sql.identifier(table)} where ${sql.identifier(column)} = ${userId}`,
  );
  return result.rowCount ?? 0;
}

/**
 * Steps in execution order. Tables created by feature 001 for later features (walks, captures,
 * ledger, leaderboards, anti-cheat) have nothing written yet, so they are plain deletes here;
 * the feature that starts writing a table replaces its step (delete or anonymise) as needed.
 * `users` is last: `refresh_tokens`, `devices`, `user_species`, `streaks` and `account_exports`
 * cascade from it; `hex_state.captain_user_id` is `SET NULL`.
 */
export const PURGE_STEPS: readonly PurgeStep[] = [
  {
    name: 'exports',
    tables: ['account_exports'],
    run: (tx, userId) => runDelete(tx, 'account_exports', 'user_id', userId),
  },
  deleteStep('refresh_tokens', 'refresh_tokens'),
  deleteStep('devices', 'devices'),
  deleteStep('anti_cheat_flags', 'anti_cheat_flags'),
  deleteStep('captures', 'captures'),
  deleteStep('walk_sessions', 'walk_sessions'),
  deleteStep('hex_week_contribution', 'hex_week_contribution'),
  deleteStep('points_ledger', 'points_ledger'),
  deleteStep('leaderboard_snapshots', 'leaderboard_snapshots'),
  deleteStep('users', 'users', 'id'),
];

/** Throws when the registry is inconsistent (unique names, `users` last, non-empty tables). */
export function validatePurgeSteps(steps: readonly PurgeStep[] = PURGE_STEPS): void {
  const names = new Set<string>();
  for (const step of steps) {
    if (names.has(step.name)) throw new Error(`duplicate purge step "${step.name}"`);
    names.add(step.name);
    if (step.tables.length === 0) throw new Error(`purge step "${step.name}" lists no tables`);
  }
  const last = steps[steps.length - 1];
  if (!last || !last.tables.includes('users')) {
    throw new Error('the last purge step must delete the users row');
  }
  if (steps.slice(0, -1).some((step) => step.tables.includes('users'))) {
    throw new Error('only the last purge step may touch users');
  }
}

/** Every table a registered step covers. */
export function purgeCoveredTables(steps: readonly PurgeStep[] = PURGE_STEPS): Set<string> {
  return new Set(steps.flatMap((step) => [...step.tables]));
}

export interface PurgeOutcome {
  steps: PurgeStepResult[];
}

/**
 * Erases everything keyed to `userId`: export objects are deleted from storage first (a failed
 * storage call aborts before any row is touched), then every step runs in one transaction.
 */
export async function purgeUser(
  db: Db,
  storage: ObjectStorage,
  userId: string,
  steps: readonly PurgeStep[] = PURGE_STEPS,
): Promise<PurgeOutcome> {
  validatePurgeSteps(steps);

  const exportRows = await db
    .select({ objectKey: accountExports.objectKey })
    .from(accountExports)
    .where(eq(accountExports.userId, userId));
  for (const row of exportRows) {
    if (row.objectKey) await storage.deleteObject(row.objectKey);
  }

  const results: PurgeStepResult[] = [];
  await db.transaction(async (tx) => {
    for (const step of steps) {
      const rows = await step.run(tx, userId);
      results.push({ name: step.name, rows });
    }
  });
  return { steps: results };
}
