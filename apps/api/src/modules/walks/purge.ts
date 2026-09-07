import { sql } from 'drizzle-orm';
import type { PurgeStep, PurgeTx } from '../me/purge.js';

/** Tables this step empties for the player, in execution order (research.md R13). */
export const WALK_PURGE_TABLES = [
  'points_ledger',
  'anti_cheat_flags',
  'hex_week_contribution',
  'walk_sessions',
] as const;

async function deleteByUser(tx: PurgeTx, table: string, userId: string): Promise<number> {
  const result = await tx.execute(
    sql`delete from ${sql.identifier(table)} where user_id = ${userId}`,
  );
  return result.rowCount ?? 0;
}

/**
 * The `walks` erasure step of the 002 `account.purge` registry (Constitution IV, FR-016):
 * deletes the player's ledger rows, anti-cheat flags, weekly contributions and walks —
 * `location_samples` and `walk_hex_meters` cascade from `walk_sessions`. Strengths already
 * folded into `hex_faction_strength` are faction aggregates without a player key and stay.
 */
export const walksPurgeStep: PurgeStep = {
  name: 'walks',
  tables: WALK_PURGE_TABLES,
  async run(tx, userId) {
    let rows = 0;
    for (const table of WALK_PURGE_TABLES) rows += await deleteByUser(tx, table, userId);
    return rows;
  },
};
