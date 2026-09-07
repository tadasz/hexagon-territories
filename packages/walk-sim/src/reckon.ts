import type { ErrorEnvelope, ReckoningQueued, ReckoningRunResult } from './api-types.js';

export interface ReckonOptions {
  /** e.g. `http://localhost:3000` (no trailing slash needed). */
  baseUrl: string;
  /** Bearer access token of a player with role `admin`. */
  token: string;
  /** ISO week in UTC, `YYYY-Www`. */
  weekId: string;
  /** Compute and print the flips without writing anything (implies `sync`). */
  dryRun?: boolean;
  /** Run inside the request and answer the result (default true); false enqueues the job (202). */
  sync?: boolean;
  /** Injectable transport (tests). */
  fetch?: typeof fetch;
}

export type ReckonResult = ReckoningRunResult | ReckoningQueued;

/** A non-2xx answer of the admin endpoint, carrying the API's error envelope. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details: Record<string, unknown> | undefined,
    readonly body: unknown,
  ) {
    super(code);
    this.name = 'ApiError';
  }
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
 * `POST /v1/admin/reckonings/{weekId}` (specs/004-weekly-reckoning/data-model.md §4): runs or
 * previews one week's reckoning through the API. Resolves with the run result (200) or the queued
 * job (202); any other status throws `ApiError` whose `code` is the envelope's error code
 * (`FORBIDDEN` for a non-admin token, `WEEK_NOT_ENDED`, `RECKONING_OUT_OF_ORDER`, …).
 */
export async function reckon(opts: ReckonOptions): Promise<ReckonResult> {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.baseUrl.replace(/\/+$/, '');
  const dryRun = opts.dryRun === true;
  const sync = dryRun || opts.sync !== false;
  const res = await doFetch(`${base}/v1/admin/reckonings/${encodeURIComponent(opts.weekId)}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${opts.token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ dryRun, sync }),
  });
  const body = await readBody(res);
  if (res.status === 200 || res.status === 202) return body as ReckonResult;
  const envelope = body as Partial<ErrorEnvelope> | null;
  const code = envelope?.error?.code;
  throw new ApiError(
    typeof code === 'string' ? code : `HTTP_${String(res.status)}`,
    res.status,
    envelope?.error?.details,
    body,
  );
}

/** Human-readable lines of a result (data-model.md §4): one per previewed flip, then a summary. */
export function formatReckonResult(result: ReckonResult): string[] {
  if (result.status === 'queued') {
    return [
      `${result.weekId}: queued as job ${result.jobId} (poll GET /v1/admin/reckonings/${result.weekId})`,
    ];
  }
  const lines = result.flipsPreview.map(
    (flip) =>
      `${flip.h3} ${flip.from === null ? '-' : String(flip.from)} → ${flip.to === null ? '-' : String(flip.to)}`,
  );
  lines.push(
    `${result.weekId}${result.dryRun ? ' (dry run)' : ''}: ${String(result.hexesProcessed)} cells, ` +
      `${String(result.flips)} flips, ${String(result.parentFlips)} parent flips, ` +
      `${String(result.walksAutofinished)} walks auto-finished, ${String(result.pushQueued)} pushes queued, ` +
      `${String(result.durationMs)} ms` +
      (result.dryRun && result.staleWalksSkipped > 0
        ? ` — ${String(result.staleWalksSkipped)} stale walks would be finished first by a real run`
        : ''),
  );
  return lines;
}
