import { randomUUID } from 'node:crypto';
import type { Sample } from '@nature/territory-rules';
import type { ErrorEnvelope, SampleBatchResult, WalkCreated, WalkSummary } from './api-types.js';

export interface ReplayOptions {
  /** e.g. `http://localhost:3000` (no trailing slash needed). */
  baseUrl: string;
  /** Bearer access token of the signed-in player. */
  token: string;
  /** Samples per batch, at most 200 (default 200). */
  batchSize?: number;
  /** 0 = send as fast as possible (default), 1 = real time, N = N× faster than real time. */
  rate?: number;
  /** Send `POST /v1/walks/{id}/finish` at the end (default true). */
  finish?: boolean;
  /** Idempotency key; a random UUID unless given. */
  clientWalkId?: string;
  /** `deviceInfo` of the creation request. */
  deviceInfo?: { model?: string; osVersion?: string; appVersion?: string };
  /** Injectable transport (tests). */
  fetch?: typeof fetch;
  /** Injectable delay (tests); default `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Called before each request with a one-line description. */
  onProgress?: (line: string) => void;
  /** Give up after this many 429 retries of one request (default 10). */
  maxRetries?: number;
}

export interface ReplayResult {
  walkId: string;
  created: WalkCreated;
  batches: SampleBatchResult[];
  /** Null when `finish` was disabled. */
  summary: WalkSummary | null;
}

/** A non-2xx answer that was not a retryable 429. */
export class ReplayError extends Error {
  constructor(
    readonly status: number,
    /** The parsed response body (usually the `Error` envelope). */
    readonly body: unknown,
    readonly request: string,
  ) {
    super(`${request} answered ${String(status)}: ${describe(body)}`);
    this.name = 'ReplayError';
  }
}

function describe(body: unknown): string {
  const envelope = body as Partial<ErrorEnvelope> | null;
  const code = envelope?.error?.code;
  return typeof code === 'string'
    ? `${code} ${envelope?.error?.message ?? ''}`.trim()
    : JSON.stringify(body);
}

export const MAX_BATCH_SIZE = 200;
/** The app flushes its outbox every 60 s of wall time while recording (plan.md Shared Semantics 4). */
export const BATCH_WINDOW_MS = 60_000;

/**
 * Splits samples into batches the way the app's outbox does: a batch closes when it holds
 * `batchSize` (≤ 200) samples or when `windowMs` of *sample time* have passed since its first
 * sample. An offline drain (or a replay at `rate` 0) has no time window and sends full batches;
 * a replay at `rate` N uses a window of 60 s × N so it flushes once per real minute.
 */
export function planBatches(
  samples: readonly Sample[],
  batchSize = MAX_BATCH_SIZE,
  windowMs: number = Number.POSITIVE_INFINITY,
): Sample[][] {
  if (samples.length === 0) return [];
  const size = Math.max(1, Math.min(MAX_BATCH_SIZE, Math.floor(batchSize)));
  const batches: Sample[][] = [];
  let current: Sample[] = [];
  let openedAt = 0;
  for (const sample of samples) {
    const ts = Date.parse(sample.ts);
    if (current.length > 0 && (current.length >= size || ts - openedAt >= windowMs)) {
      batches.push(current);
      current = [];
    }
    if (current.length === 0) openedAt = ts;
    current.push(sample);
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Sample-time window of one batch for a replay rate (0 = no window, N = 60 s × N). */
export function batchWindowMs(rate: number): number {
  return rate > 0 ? BATCH_WINDOW_MS * rate : Number.POSITIVE_INFINITY;
}

function retryAfterMs(res: Response, body: unknown): number {
  const header = Number(res.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const details = (body as Partial<ErrorEnvelope> | null)?.error?.details;
  const fromBody = Number(details?.retryAfterS);
  return Number.isFinite(fromBody) && fromBody > 0 ? fromBody * 1000 : 5_000;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * Replays a sample stream as one walk: `POST /v1/walks`, sample batches in order (waiting for
 * the simulated clock when `rate > 0`), then `finish`. A `429` is retried after its
 * `retry-after`; any other non-2xx throws `ReplayError` with the error envelope.
 */
export async function replay(
  samples: readonly Sample[],
  pedometerSteps: number | null,
  opts: ReplayOptions,
): Promise<ReplayResult> {
  const doFetch = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const progress = opts.onProgress ?? (() => undefined);
  const rate = opts.rate ?? 0;
  const maxRetries = opts.maxRetries ?? 10;
  const base = opts.baseUrl.replace(/\/+$/, '');

  async function call<T>(method: string, path: string, payload: unknown): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      progress(`${method} ${path}${attempt > 0 ? ` (retry ${String(attempt)})` : ''}`);
      const res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${opts.token}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const body = await readBody(res);
      if (res.ok) return body as T;
      if (res.status === 429 && attempt < maxRetries) {
        const wait = retryAfterMs(res, body);
        progress(`429 — waiting ${String(Math.ceil(wait / 1000))} s`);
        await sleep(wait);
        continue;
      }
      throw new ReplayError(res.status, body, `${method} ${path}`);
    }
  }

  const firstTs = samples[0]?.ts ?? new Date().toISOString();
  const lastTs = samples[samples.length - 1]?.ts ?? firstTs;
  const created = await call<WalkCreated>('POST', '/v1/walks', {
    clientWalkId: opts.clientWalkId ?? randomUUID(),
    startedAt: firstTs,
    ...(opts.deviceInfo ? { deviceInfo: opts.deviceInfo } : {}),
  });
  const walkId = created.walkId;

  const wallStart = Date.now();
  const simStart = Date.parse(firstTs);
  const batches: SampleBatchResult[] = [];
  for (const batch of planBatches(samples, opts.batchSize, batchWindowMs(rate))) {
    if (rate > 0) {
      const last = Date.parse(batch[batch.length - 1]!.ts);
      const due = wallStart + (last - simStart) / rate;
      const wait = due - Date.now();
      if (wait > 0) await sleep(wait);
    }
    batches.push(
      await call<SampleBatchResult>('POST', `/v1/walks/${walkId}/samples`, { samples: batch }),
    );
  }

  let summary: WalkSummary | null = null;
  if (opts.finish !== false) {
    summary = await call<WalkSummary>('POST', `/v1/walks/${walkId}/finish`, {
      endedAt: lastTs,
      ...(pedometerSteps !== null ? { pedometerTotal: pedometerSteps } : {}),
    });
  }
  return { walkId, created, batches, summary };
}
