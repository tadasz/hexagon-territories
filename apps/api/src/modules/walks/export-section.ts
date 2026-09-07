import { desc, eq } from 'drizzle-orm';
import { pointsLedger, walkSessions } from '../../db/schema/index.js';
import { bigIntToCell } from '../../lib/h3.js';
import type { ExportSection } from '../me/export-sections.js';
import { buildSummary, summaryColumns } from './summary.js';

/**
 * `walks` section of the 002 export bundle (FR-016, research.md R13): every walk of the player
 * as its summary (simplified path as GeoJSON, per-hex metres, week standing at export time)
 * plus the device info; raw samples are not exported (they are gone after 30 days anyway).
 */
export const walksExportSection: ExportSection = {
  name: 'walks',
  async run({ db }, userId) {
    const rows = await db
      .select({ ...summaryColumns, deviceInfo: walkSessions.deviceInfo })
      .from(walkSessions)
      .where(eq(walkSessions.userId, userId))
      .orderBy(desc(walkSessions.startedAt), desc(walkSessions.id));
    const walks = [];
    for (const row of rows) {
      const summary = await buildSummary(db, row);
      walks.push({ ...summary, deviceInfo: row.deviceInfo ?? null });
    }
    return walks;
  },
};

/** `points` section: the player's XP ledger (walk XP from this feature, later captures etc.). */
export const pointsExportSection: ExportSection = {
  name: 'points',
  async run({ db }, userId) {
    const rows = await db
      .select()
      .from(pointsLedger)
      .where(eq(pointsLedger.userId, userId))
      .orderBy(desc(pointsLedger.createdAt), desc(pointsLedger.id));
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      points: row.points,
      factionId: row.factionId,
      refType: row.refType,
      refId: row.refId,
      h3: row.h3R9 === null ? null : bigIntToCell(row.h3R9),
      weekId: row.weekId,
      createdAt: row.createdAt.toISOString(),
    }));
  },
};
