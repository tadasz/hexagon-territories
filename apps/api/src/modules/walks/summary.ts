import { and, eq, sql } from 'drizzle-orm';
import type { DbLike } from '../../db/client.js';
import {
  walkHexMeters,
  walkSessions,
  type FinishReason,
  type WalkFlag,
} from '../../db/schema/index.js';
import { geoJsonLineString } from '../../lib/geo.js';
import { bigIntToCell } from '../../lib/h3.js';
import type { WalkListItem, WalkSummary } from './schemas.js';
import { weekStanding } from './standing.js';

/** The `walk_sessions` columns a summary needs (never the raw `path`). */
export const summaryColumns = {
  id: walkSessions.id,
  userId: walkSessions.userId,
  clientWalkId: walkSessions.clientWalkId,
  factionId: walkSessions.factionId,
  startedAt: walkSessions.startedAt,
  endedAt: walkSessions.endedAt,
  finishedAt: walkSessions.finishedAt,
  status: walkSessions.status,
  finishReason: walkSessions.finishReason,
  weekId: walkSessions.weekId,
  distanceM: walkSessions.distanceM,
  durationS: walkSessions.durationS,
  steps: walkSessions.steps,
  sampleCount: walkSessions.sampleCount,
  hexCount: walkSessions.hexCount,
  flags: walkSessions.flags,
  xpAwarded: walkSessions.xpAwarded,
  scored: walkSessions.scored,
  pathSimplifiedGeoJson: sql<string | null>`ST_AsGeoJSON(${walkSessions.pathSimplified})`,
};

export interface SummaryRow {
  id: string;
  userId: string;
  clientWalkId: string;
  factionId: number | null;
  startedAt: Date;
  endedAt: Date | null;
  finishedAt: Date | null;
  status: WalkSummary['status'];
  finishReason: FinishReason | null;
  weekId: string | null;
  distanceM: number | null;
  durationS: number | null;
  steps: number | null;
  sampleCount: number;
  hexCount: number;
  flags: WalkFlag[];
  xpAwarded: number;
  scored: boolean;
  pathSimplifiedGeoJson: string | null;
}

const iso = (date: Date | null | undefined): string | null => (date ? date.toISOString() : null);

/** `WalkListItem` of one row (no path, no hexes). */
export function toListItem(row: SummaryRow): WalkListItem {
  return {
    walkId: row.id,
    clientWalkId: row.clientWalkId,
    status: row.status,
    finishReason: row.finishReason,
    startedAt: row.startedAt.toISOString(),
    endedAt: iso(row.endedAt),
    weekId: row.weekId,
    distanceM: row.distanceM ?? 0,
    durationS: row.durationS ?? 0,
    hexCount: row.hexCount,
    xp: row.xpAwarded,
    scored: row.scored,
    flags: row.flags,
  };
}

/**
 * Builds the `WalkSummary` of one walk row: per-cell raw and counted metres from
 * `walk_hex_meters`, the week standing read model (research.md R8) and the simplified path as
 * GeoJSON. Reads only; the same function serves the finish response and `GET /v1/walks/{id}`.
 */
export async function buildSummary(db: DbLike, row: SummaryRow): Promise<WalkSummary> {
  const hexRows = await db
    .select({
      h3R9: walkHexMeters.h3R9,
      meters: walkHexMeters.meters,
      cappedMeters: walkHexMeters.cappedMeters,
    })
    .from(walkHexMeters)
    .where(eq(walkHexMeters.walkId, row.id));
  const byCell = new Map(hexRows.map((h) => [bigIntToCell(h.h3R9), h]));
  const cells = [...byCell.keys()].sort();
  const standing =
    row.weekId && cells.length > 0
      ? await weekStanding(db, cells, row.weekId, row.factionId)
      : new Map<string, WalkSummary['hexes'][number]['weekStanding']>();
  const hexes = cells.map((cell) => {
    const hex = byCell.get(cell)!;
    return {
      h3: cell,
      meters: hex.meters,
      cappedMeters: row.scored ? hex.cappedMeters : 0,
      weekStanding: standing.get(cell) ?? { leader: null, myFactionShare: 0, owner: null },
    };
  });
  return {
    ...toListItem(row),
    finishedAt: iso(row.finishedAt),
    steps: row.steps,
    sampleCount: row.sampleCount,
    hexes,
    path: geoJsonLineString(row.pathSimplifiedGeoJson),
  };
}

/** A walk as a `WalkSummary`, or null when unknown or (with `userId`) not the caller's. */
export async function loadSummary(
  db: DbLike,
  walkId: string,
  userId?: string,
): Promise<WalkSummary | null> {
  const [row] = await db
    .select(summaryColumns)
    .from(walkSessions)
    .where(
      userId === undefined
        ? eq(walkSessions.id, walkId)
        : and(eq(walkSessions.id, walkId), eq(walkSessions.userId, userId)),
    )
    .limit(1);
  return row ? buildSummary(db, row) : null;
}
