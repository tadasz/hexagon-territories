import {
  acceptSamples,
  applyWeeklyCap,
  haversineM,
  pathLengthM,
  pathToHexMeters,
  sampleTimeMs,
  simplifyPath,
  walkFlags,
  weekIdFor,
  type HexMeters,
  type LatLng,
  type RejectedSample,
  type Sample,
  type WalkFlag,
} from '@nature/territory-rules';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { DbLike, Tx } from '../../db/client.js';
import {
  antiCheatFlags,
  hexWeekContribution,
  locationSamples,
  pointsLedger,
  users,
  walkHexMeters,
  walkSessions,
  type FinishReason,
} from '../../db/schema/index.js';
import { AppError, ERROR_CODES } from '../../errors.js';
import { lineStringSql } from '../../lib/geo.js';
import { cellToBigInt } from '../../lib/h3.js';
import { WALK_XP_DAILY_CAP, utcDayStart, xpForDistance } from './limits.js';
import type { WalkSummary } from './schemas.js';
import { buildSummary, summaryColumns } from './summary.js';

/** The pure half of `finishWalk`: the rules pipeline over a walk's stored samples. */
export interface ScoredSamples {
  accepted: Sample[];
  rejected: RejectedSample[];
  flags: WalkFlag[];
  /** Douglas–Peucker output over the accepted samples (the path that is scored and stored). */
  simplified: LatLng[];
  /** Haversine length of `simplified`. */
  distanceM: number;
  /** Sorted by cell ascending; empty with fewer than two accepted samples. */
  hexes: HexMeters[];
  /** Median implied speed between consecutive accepted samples (m/s); 0 without segments. */
  medianSpeedMps: number;
  /** First to last accepted sample (s). */
  acceptedDurationS: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * `acceptSamples` → `walkFlags` → `simplifyPath` → `pathLengthM` → `pathToHexMeters`, exactly
 * as `packages/territory-rules/README.md` "finishWalk pipeline" (Constitution II: nothing is
 * re-implemented here). Deterministic; unit-tested against the `walk-paths.json` fixtures.
 */
export function scoreSamples(
  samples: readonly Sample[],
  pedometerSteps?: number | null,
): ScoredSamples {
  const { accepted, rejected } = acceptSamples(samples);
  const flags = walkFlags(accepted, pedometerSteps);
  const points = accepted.map((s) => ({ lat: s.lat, lon: s.lon }));
  const simplified = points.length >= 2 ? simplifyPath(points) : [];
  const speeds: number[] = [];
  for (let i = 1; i < accepted.length; i += 1) {
    const a = accepted[i - 1]!;
    const b = accepted[i]!;
    const dt = (sampleTimeMs(b) - sampleTimeMs(a)) / 1000;
    speeds.push(dt > 0 ? haversineM(a, b) / dt : 0);
  }
  const first = accepted[0];
  const last = accepted[accepted.length - 1];
  return {
    accepted,
    rejected,
    flags,
    simplified,
    distanceM: pathLengthM(simplified),
    hexes: pathToHexMeters(simplified),
    medianSpeedMps: median(speeds),
    acceptedDurationS: first && last ? (sampleTimeMs(last) - sampleTimeMs(first)) / 1000 : 0,
  };
}

/** Timestamp of the last accepted stored sample of a walk, or null. */
export async function lastAcceptedSampleTs(db: DbLike, walkId: string): Promise<Date | null> {
  const [row] = await db
    .select({ ts: locationSamples.ts })
    .from(locationSamples)
    .where(and(eq(locationSamples.walkId, walkId), eq(locationSamples.accepted, true)))
    .orderBy(desc(locationSamples.ts))
    .limit(1);
  return row?.ts ?? null;
}

/** The stored samples of a walk in `seq` order, one per `seq` (lowest `ts` wins). */
export async function loadWalkSamples(db: DbLike, walkId: string): Promise<Sample[]> {
  const rows = await db
    .select({
      seq: locationSamples.seq,
      ts: locationSamples.ts,
      lat: locationSamples.lat,
      lon: locationSamples.lon,
      hAcc: locationSamples.hAcc,
      speed: locationSamples.speed,
      course: locationSamples.course,
      alt: locationSamples.alt,
    })
    .from(locationSamples)
    .where(eq(locationSamples.walkId, walkId))
    .orderBy(asc(locationSamples.seq), asc(locationSamples.ts));
  const samples: Sample[] = [];
  let lastSeq = -1;
  for (const row of rows) {
    if (row.seq === lastSeq) continue;
    lastSeq = row.seq;
    samples.push({
      seq: row.seq,
      ts: row.ts.toISOString(),
      lat: row.lat,
      lon: row.lon,
      hAcc: row.hAcc,
      speed: row.speed,
      course: row.course,
      alt: row.alt,
    });
  }
  return samples;
}

export interface FinishWalkInput {
  walkId: string;
  /** Client-reported end; clamped to `[last accepted sample, now]` (research.md R4). */
  endedAt: Date;
  reason: FinishReason;
  /** Server time of the transaction (`finished_at`, XP day window). */
  now: Date;
  /** `pedometerTotal` of the finish request; undefined keeps the steps summed from batches. */
  pedometerTotal?: number | null;
  /** Daily walking-XP cap (config; default `WALK_XP_DAILY_CAP`). */
  xpDailyCap?: number;
}

/**
 * The only place walking metres are scored (Constitution I/II; research.md R1, R4–R7). Runs in
 * the caller's transaction, locks the walk row, and:
 *  1. returns the stored summary when the walk is no longer `active` (idempotent);
 *  2. re-runs the shared filter over every stored sample and overwrites `accepted`/`reject_reason`;
 *  3. clamps `endedAt`, derives `week_id`, stores the path, the simplified path and per-cell metres;
 *  4. unflagged: upserts the player's weekly contribution per cell with the 2 000 m cap, writes one
 *     `walk_distance` ledger row (daily cap) and bumps `users.xp`; flagged: one `anti_cheat_flags`
 *     row per flag and nothing else;
 *  5. marks the walk `finished` / `flagged` with `finish_reason` and answers the summary.
 * Ownership (`hex_state.owner_faction_id`) is never touched.
 */
export async function finishWalk(tx: Tx, input: FinishWalkInput): Promise<WalkSummary> {
  const [walk] = await tx
    .select(summaryColumns)
    .from(walkSessions)
    .where(eq(walkSessions.id, input.walkId))
    .for('update');
  if (!walk) throw new AppError(404, ERROR_CODES.WALK_NOT_FOUND, 'Walk not found');
  if (walk.status !== 'active') return buildSummary(tx, walk);

  // The player's faction at finish time is credited (spec edge case); the row is locked so two
  // finishes of the same player serialise on the XP window.
  const [player] = await tx
    .select({ factionId: users.factionId })
    .from(users)
    .where(eq(users.id, walk.userId))
    .for('update');
  const factionId = player?.factionId ?? walk.factionId;

  const samples = await loadWalkSamples(tx, walk.id);
  const steps = input.pedometerTotal === undefined ? walk.steps : input.pedometerTotal;
  const scored = scoreSamples(samples, steps);

  if (samples.length > 0) {
    await tx
      .update(locationSamples)
      .set({ accepted: true, rejectReason: null })
      .where(
        and(
          eq(locationSamples.walkId, walk.id),
          sql`${locationSamples.seq} = any(${sql.param(scored.accepted.map((s) => s.seq))}::int[])`,
        ),
      );
    const byReason = new Map<RejectedSample['reason'], number[]>();
    for (const r of scored.rejected)
      byReason.set(r.reason, [...(byReason.get(r.reason) ?? []), r.seq]);
    for (const [reason, seqs] of byReason) {
      await tx
        .update(locationSamples)
        .set({ accepted: false, rejectReason: reason })
        .where(
          and(
            eq(locationSamples.walkId, walk.id),
            sql`${locationSamples.seq} = any(${sql.param(seqs)}::int[])`,
          ),
        );
    }
  }

  const lastAccepted = scored.accepted[scored.accepted.length - 1];
  const lower = Math.max(
    walk.startedAt.getTime(),
    lastAccepted ? sampleTimeMs(lastAccepted) : walk.startedAt.getTime(),
  );
  const upper = Math.max(input.now.getTime(), lower);
  const endedAt = new Date(Math.min(Math.max(input.endedAt.getTime(), lower), upper));
  const durationS = Math.max(0, Math.round((endedAt.getTime() - walk.startedAt.getTime()) / 1000));
  const weekId = weekIdFor(endedAt);
  const flagged = scored.flags.length > 0;

  const cappedByCell = new Map<string, number>();
  let xp = 0;
  if (!flagged && factionId !== null) {
    for (const hex of scored.hexes) {
      const h3 = cellToBigInt(hex.cell);
      const [existing] = await tx
        .select({
          meters: hexWeekContribution.meters,
          cappedMeters: hexWeekContribution.cappedMeters,
        })
        .from(hexWeekContribution)
        .where(
          and(
            eq(hexWeekContribution.h3R9, h3),
            eq(hexWeekContribution.weekId, weekId),
            eq(hexWeekContribution.factionId, factionId),
            eq(hexWeekContribution.userId, walk.userId),
          ),
        )
        .for('update');
      const oldCapped = existing?.cappedMeters ?? 0;
      const [capped] = applyWeeklyCap([
        {
          cell: hex.cell,
          factionId,
          userId: walk.userId,
          meters: (existing?.meters ?? 0) + hex.meters,
        },
      ]);
      const total = capped!;
      await tx
        .insert(hexWeekContribution)
        .values({
          h3R9: h3,
          weekId,
          factionId,
          userId: walk.userId,
          meters: total.meters,
          cappedMeters: total.cappedMeters,
          walks: 1,
          updatedAt: input.now,
        })
        .onConflictDoUpdate({
          target: [
            hexWeekContribution.h3R9,
            hexWeekContribution.weekId,
            hexWeekContribution.factionId,
            hexWeekContribution.userId,
          ],
          set: {
            meters: total.meters,
            cappedMeters: total.cappedMeters,
            walks: sql`${hexWeekContribution.walks} + 1`,
            updatedAt: input.now,
          },
        });
      cappedByCell.set(hex.cell, Math.max(0, total.cappedMeters - oldCapped));
    }

    const today = await tx.execute<{ total: number | string }>(sql`
      select coalesce(sum(points), 0) as total from points_ledger
      where user_id = ${walk.userId} and kind = 'walk_distance' and created_at >= ${utcDayStart(input.now)}
    `);
    xp = xpForDistance(
      scored.distanceM,
      Number(today.rows[0]?.total ?? 0),
      input.xpDailyCap ?? WALK_XP_DAILY_CAP,
    );
    await tx.insert(pointsLedger).values({
      userId: walk.userId,
      factionId,
      kind: 'walk_distance',
      points: xp,
      refType: 'walk',
      refId: walk.id,
      weekId,
      createdAt: input.now,
    });
    if (xp > 0) {
      await tx
        .update(users)
        .set({ xp: sql`${users.xp} + ${xp}` })
        .where(eq(users.id, walk.userId));
    }
  }

  if (flagged) {
    await tx.insert(antiCheatFlags).values(
      scored.flags.map((code) => ({
        userId: walk.userId,
        walkId: walk.id,
        code,
        details: {
          distanceM: scored.distanceM,
          durationS: scored.acceptedDurationS,
          medianSpeedMps: scored.medianSpeedMps,
          steps,
          sampleCount: samples.length,
        },
        createdAt: input.now,
      })),
    );
  }

  await tx.delete(walkHexMeters).where(eq(walkHexMeters.walkId, walk.id));
  if (scored.hexes.length > 0) {
    await tx.insert(walkHexMeters).values(
      scored.hexes.map((hex) => ({
        walkId: walk.id,
        h3R9: cellToBigInt(hex.cell),
        meters: hex.meters,
        cappedMeters: cappedByCell.get(hex.cell) ?? 0,
      })),
    );
  }

  await tx
    .update(walkSessions)
    .set({
      status: flagged ? 'flagged' : 'finished',
      finishReason: input.reason,
      factionId,
      endedAt,
      finishedAt: input.now,
      weekId,
      distanceM: scored.distanceM,
      durationS,
      steps,
      sampleCount: samples.length,
      hexCount: scored.hexes.length,
      flags: scored.flags,
      xpAwarded: xp,
      scored: !flagged,
      path: scored.accepted.length >= 2 ? lineStringSql(scored.accepted) : null,
      pathSimplified: scored.simplified.length >= 2 ? lineStringSql(scored.simplified) : null,
    })
    .where(eq(walkSessions.id, walk.id));

  const [updated] = await tx
    .select(summaryColumns)
    .from(walkSessions)
    .where(eq(walkSessions.id, walk.id));
  return buildSummary(tx, updated!);
}
