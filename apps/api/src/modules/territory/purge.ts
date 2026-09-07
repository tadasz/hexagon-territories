import { sql } from 'drizzle-orm';
import type { PurgeStep, PurgeTx } from '../me/purge.js';
import { PUSH_SEND } from './reckoning/push.js';

/**
 * Erasure steps of feature 004 for the 002 `account.purge` registry (research.md R17,
 * Constitution IV). Leaderboard rows are anonymised, not deleted, so historical boards keep
 * their shape; captain references are cleared; queued result pushes are dropped. Ownership
 * events carry no player and stay untouched.
 */

/** `UPDATE leaderboard_snapshots SET user_id = NULL` — rank and metres are kept. */
export const leaderboardPurgeStep: PurgeStep = {
  name: 'leaderboard_snapshots',
  tables: ['leaderboard_snapshots'],
  async run(tx, userId) {
    const result = await tx.execute(
      sql`update leaderboard_snapshots set user_id = null where user_id = ${userId}`,
    );
    return result.rowCount ?? 0;
  },
};

/** Tables the `territory` step touches (the FK-coverage test reads this list). */
export const TERRITORY_PURGE_TABLES = ['hex_reckoning_history', 'hex_state', 'pgboss.job'] as const;

async function clearColumn(tx: PurgeTx, table: string, column: string, userId: string) {
  const result = await tx.execute(
    sql`update ${sql.identifier(table)} set ${sql.identifier(column)} = null where ${sql.identifier(column)} = ${userId}`,
  );
  return result.rowCount ?? 0;
}

/**
 * Clears the player's captain references (current and per-week history) and deletes their
 * queued `push.send` rows. The pg-boss table only exists once jobs have started, hence the
 * `to_regclass` guard.
 */
export const territoryPurgeStep: PurgeStep = {
  name: 'territory',
  tables: TERRITORY_PURGE_TABLES,
  async run(tx, userId) {
    let rows = 0;
    rows += await clearColumn(tx, 'hex_reckoning_history', 'captain_user_id', userId);
    rows += await clearColumn(tx, 'hex_reckoning_history', 'captain_before_user_id', userId);
    rows += await clearColumn(tx, 'hex_state', 'captain_user_id', userId);
    const exists = await tx.execute<{ present: boolean }>(
      sql`select to_regclass('pgboss.job') is not null as present`,
    );
    if (exists.rows[0]?.present) {
      const deleted = await tx.execute(sql`
        delete from pgboss.job
        where name = ${PUSH_SEND} and state in ('created', 'retry') and data->>'userId' = ${userId}
      `);
      rows += deleted.rowCount ?? 0;
    }
    return rows;
  },
};
