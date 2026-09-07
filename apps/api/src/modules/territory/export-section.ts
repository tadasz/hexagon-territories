import { and, asc, eq } from 'drizzle-orm';
import { hexState, leaderboardSnapshots, pointsLedger } from '../../db/schema/index.js';
import { bigIntToCell } from '../../lib/h3.js';
import type { ExportSection } from '../me/export-sections.js';

/**
 * `territory` section of the 002 export bundle (research.md R17, Constitution IV): the flips
 * the player took part in (their `hex_flip` XP rows), the cells they currently captain and
 * their leaderboard placements.
 */
export const territoryExportSection: ExportSection = {
  name: 'territory',
  async run({ db }, userId) {
    const flipRows = await db
      .select({
        h3: pointsLedger.h3R9,
        weekId: pointsLedger.weekId,
        points: pointsLedger.points,
        factionId: pointsLedger.factionId,
      })
      .from(pointsLedger)
      .where(and(eq(pointsLedger.userId, userId), eq(pointsLedger.kind, 'hex_flip')))
      .orderBy(asc(pointsLedger.weekId), asc(pointsLedger.h3R9));
    const captainRows = await db
      .select({ h3: hexState.h3R9 })
      .from(hexState)
      .where(eq(hexState.captainUserId, userId))
      .orderBy(asc(hexState.h3R9));
    const boardRows = await db
      .select({
        weekId: leaderboardSnapshots.weekId,
        scope: leaderboardSnapshots.scope,
        scopeId: leaderboardSnapshots.scopeId,
        rank: leaderboardSnapshots.rank,
        meters: leaderboardSnapshots.meters,
        points: leaderboardSnapshots.points,
      })
      .from(leaderboardSnapshots)
      .where(eq(leaderboardSnapshots.userId, userId))
      .orderBy(
        asc(leaderboardSnapshots.weekId),
        asc(leaderboardSnapshots.scope),
        asc(leaderboardSnapshots.scopeId),
      );
    return {
      flips: flipRows.map((row) => ({
        h3: row.h3 === null ? null : bigIntToCell(row.h3),
        weekId: row.weekId,
        factionId: row.factionId,
        xp: row.points,
      })),
      captainOf: captainRows.map((row) => bigIntToCell(row.h3)),
      leaderboard: boardRows,
    };
  },
};
