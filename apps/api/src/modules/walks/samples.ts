import { acceptSamples, type Sample } from '@nature/territory-rules';
import { and, asc, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { locationSamples, walkSessions } from '../../db/schema/index.js';
import { AppError, ERROR_CODES } from '../../errors.js';
import { SAMPLES_PER_DAY, secondsToUtcMidnight, utcDayStart } from './limits.js';
import type { LocationSample, SampleBatchRequest, SampleBatchResult } from './schemas.js';

export interface StoreBatchInput {
  walkId: string;
  userId: string;
  body: SampleBatchRequest;
  now: Date;
  /** Daily stored-sample quota per player (config; default `SAMPLES_PER_DAY`). */
  samplesPerDay?: number;
}

/** The stored (float4) view of a request sample, so the provisional and the final filter agree. */
function toStoredSample(s: LocationSample): Sample {
  return {
    seq: s.seq,
    ts: new Date(s.ts).toISOString(),
    lat: s.lat,
    lon: s.lon,
    hAcc: Math.fround(s.hAcc),
    speed: s.speed === undefined || s.speed === null ? null : Math.fround(s.speed),
    course: s.course ?? null,
    alt: s.alt ?? null,
  };
}

/**
 * Stores one batch idempotently by `(walk, seq)` (research.md R2): locks the walk (serialising
 * batches per walk), refuses a non-active walk, skips seqs already stored, enforces the daily
 * quota on the rows that are actually new, evaluates the shared filter provisionally against the
 * last accepted stored sample that precedes the batch, inserts, and bumps `sample_count`.
 * Nothing is scored here.
 */
export async function storeBatch(tx: Tx, input: StoreBatchInput): Promise<SampleBatchResult> {
  const { walkId, userId, body, now } = input;
  const [walk] = await tx
    .select({
      id: walkSessions.id,
      status: walkSessions.status,
      sampleCount: walkSessions.sampleCount,
    })
    .from(walkSessions)
    .where(and(eq(walkSessions.id, walkId), eq(walkSessions.userId, userId)))
    .for('update');
  if (!walk) throw new AppError(404, ERROR_CODES.WALK_NOT_FOUND, 'Walk not found');
  if (walk.status !== 'active') {
    throw new AppError(409, ERROR_CODES.WALK_NOT_ACTIVE, `Walk is ${walk.status}`, {
      status: walk.status,
    });
  }

  const bySeq = new Map<number, LocationSample>();
  for (const sample of body.samples) if (!bySeq.has(sample.seq)) bySeq.set(sample.seq, sample);
  const seqs = [...bySeq.keys()];
  const minSeq = Math.min(...seqs);
  const maxSeq = Math.max(...seqs);
  const existing = await tx
    .select({ seq: locationSamples.seq })
    .from(locationSamples)
    .where(
      and(
        eq(locationSamples.walkId, walkId),
        gte(locationSamples.seq, minSeq),
        lte(locationSamples.seq, maxSeq),
      ),
    );
  const existingSeqs = new Set(existing.map((row) => row.seq));
  const fresh = [...bySeq.values()]
    .filter((s) => !existingSeqs.has(s.seq))
    .sort((a, b) => a.seq - b.seq);
  const duplicates = body.samples.length - fresh.length;

  if (fresh.length === 0) {
    return { stored: 0, duplicates, accepted: [], rejected: [], sampleCount: walk.sampleCount };
  }

  const quota = input.samplesPerDay ?? SAMPLES_PER_DAY;
  const today = await tx.execute<{ total: number | string }>(sql`
    select coalesce(sum(sample_count), 0) as total from walk_sessions
    where user_id = ${userId} and started_at >= ${utcDayStart(now)}
  `);
  const storedToday = Number(today.rows[0]?.total ?? 0);
  if (storedToday + fresh.length > quota) {
    const retryAfterS = secondsToUtcMidnight(now);
    throw new AppError(
      429,
      ERROR_CODES.SAMPLE_QUOTA_EXCEEDED,
      `Daily sample quota of ${String(quota)} reached; retry in ${String(retryAfterS)} s`,
      { retryAfterS, samplesPerDay: quota, storedToday },
    );
  }

  // Provisional filter: the new rows after the last accepted stored sample that precedes them.
  const [anchor] = await tx
    .select({
      seq: locationSamples.seq,
      ts: locationSamples.ts,
      lat: locationSamples.lat,
      lon: locationSamples.lon,
      hAcc: locationSamples.hAcc,
      speed: locationSamples.speed,
    })
    .from(locationSamples)
    .where(
      and(
        eq(locationSamples.walkId, walkId),
        eq(locationSamples.accepted, true),
        lt(locationSamples.seq, minSeq),
      ),
    )
    .orderBy(desc(locationSamples.seq), asc(locationSamples.ts))
    .limit(1);
  const filterInput: Sample[] = fresh.map(toStoredSample);
  if (anchor) {
    filterInput.push({
      seq: anchor.seq,
      ts: anchor.ts.toISOString(),
      lat: anchor.lat,
      lon: anchor.lon,
      hAcc: anchor.hAcc,
      speed: anchor.speed,
    });
  }
  const result = acceptSamples(filterInput);
  const acceptedSeqs = result.accepted.map((s) => s.seq).filter((seq) => seq !== anchor?.seq);
  const rejected = result.rejected.filter((r) => r.seq !== anchor?.seq);
  const reasonBySeq = new Map(rejected.map((r) => [r.seq, r.reason]));

  await tx
    .insert(locationSamples)
    .values(
      fresh.map((s) => ({
        walkId,
        seq: s.seq,
        ts: new Date(s.ts),
        lat: s.lat,
        lon: s.lon,
        hAcc: s.hAcc,
        speed: s.speed ?? null,
        course: s.course ?? null,
        alt: s.alt ?? null,
        accepted: !reasonBySeq.has(s.seq),
        rejectReason: reasonBySeq.get(s.seq) ?? null,
      })),
    )
    .onConflictDoNothing();

  const pedometerSteps = body.pedometer?.steps;
  await tx
    .update(walkSessions)
    .set({
      sampleCount: sql`${walkSessions.sampleCount} + ${fresh.length}`,
      ...(pedometerSteps !== undefined
        ? { steps: sql`coalesce(${walkSessions.steps}, 0) + ${pedometerSteps}` }
        : {}),
    })
    .where(eq(walkSessions.id, walkId));

  return {
    stored: fresh.length,
    duplicates,
    accepted: acceptedSeqs,
    rejected,
    sampleCount: walk.sampleCount + fresh.length,
  };
}
