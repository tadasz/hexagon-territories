import type { FastifyPluginCallbackTypebox } from '@fastify/type-provider-typebox';
import { sql } from 'drizzle-orm';
import type { AppConfig } from '../../config.js';
import type { ReckoningStage } from '../../db/schema/index.js';
import { AppError, ERROR_CODES } from '../../errors.js';
import { RECKONING_SINGLETON_KEY, RECKONING_WEEKLY } from '../../jobs/reckoning-weekly.js';
import type { Clock } from '../../lib/time.js';
import { rejectInvalid } from '../../lib/validation.js';
import { ErrorRef } from '../../schemas/error.js';
import { requireRole } from '../admin/guard.js';
import { buildReckoningDeps } from './reckoning/deps.js';
import { isReckoningError } from './reckoning/errors.js';
import { runReckoning } from './reckoning/run.js';
import {
  ReckoningQueuedRef,
  ReckoningRunRequestRef,
  ReckoningRunResultRef,
  ReckoningStatusRef,
  WeekIdParamsSchema,
  type ReckoningStatus,
} from './schemas.js';
import { isWeekId } from './weeks.js';

export interface AdminReckoningRoutesOptions {
  config: Pick<AppConfig, 'walks' | 'territory'>;
  clock: Clock;
}

const unauthorized = {
  ...ErrorRef,
  description:
    'Missing or invalid access token (UNAUTHORIZED), expired token (TOKEN_EXPIRED) or deleted account (ACCOUNT_DELETED)',
};
const forbidden = { ...ErrorRef, description: 'The caller is not an admin (FORBIDDEN)' };

type StatusRow = {
  week_id: string;
  status: ReckoningStatus['status'];
  stage: ReckoningStage;
  attempt: number;
  started_at: Date | string;
  finished_at: Date | string | null;
  hexes_processed: number;
  flips: number;
  parent_flips: number;
  batches: number;
  walks_autofinished: number;
  push_queued: number;
  error: string | null;
};

const iso = (value: Date | string): string =>
  (value instanceof Date ? value : new Date(value)).toISOString();

/**
 * `POST/GET /v1/admin/reckonings/{weekId}` (specs/004-weekly-reckoning/research.md R12, tag
 * `admin`): role `admin` only. The POST runs the same `runReckoning` the job runs, either in the
 * request (`sync`) or by enqueuing `reckoning.weekly` with its singleton key.
 */
export const adminReckoningRoutes: FastifyPluginCallbackTypebox<AdminReckoningRoutesOptions> = (
  fastify,
  opts,
  done,
) => {
  const security = [{ bearerAuth: [] }];
  const adminOnly = [fastify.authenticate, requireRole('admin')];

  fastify.post(
    '/v1/admin/reckonings/:weekId',
    {
      preHandler: adminOnly,
      attachValidation: true,
      schema: {
        tags: ['admin'],
        operationId: 'runReckoning',
        summary: 'Run (or preview) the reckoning of one week',
        description:
          'Role `admin` only. Runs the same code as the scheduled job. `sync: true` runs in the request and answers the result (200); otherwise the job is enqueued (202). `dryRun` (requires `sync`) writes nothing — no state, events, snapshots, XP, pushes, no reckoning row — skips the auto-finish of stale walks, and returns the flips it would have made (≤ 1 000 entries). The week must have ended (400 WEEK_NOT_ENDED) and be the next in sequence after the last completed reckoning (409 RECKONING_OUT_OF_ORDER, `details.expectedWeekId`); a week already done answers its stored result with 200; a reckoning already running answers 409 RECKONING_RUNNING. Synchronous runs are meant for development and test datasets; production sizes should be enqueued.',
        security,
        params: WeekIdParamsSchema,
        body: ReckoningRunRequestRef,
        response: {
          200: { ...ReckoningRunResultRef, description: 'Ran synchronously (or was already done)' },
          202: { ...ReckoningQueuedRef, description: 'Enqueued for the job worker' },
          400: {
            ...ErrorRef,
            description:
              'Validation failed (VALIDATION_FAILED; `details.field` is `weekId` or `dryRun`) or the week has not ended (WEEK_NOT_ENDED, `details.endsAt`)',
          },
          401: unauthorized,
          403: forbidden,
          409: {
            ...ErrorRef,
            description:
              'Out of sequence (RECKONING_OUT_OF_ORDER, `details.expectedWeekId`) or already running (RECKONING_RUNNING)',
          },
          503: {
            ...ErrorRef,
            description: 'Async run requested while jobs are disabled (JOBS_DISABLED)',
          },
        },
      },
    },
    async (request, reply) => {
      rejectInvalid(request);
      const { weekId } = request.params;
      const dryRun = request.body?.dryRun === true;
      const sync = request.body?.sync === true;
      if (!isWeekId(weekId)) {
        throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, `${weekId} is not an ISO week`, {
          field: 'weekId',
        });
      }
      if (dryRun && !sync) {
        throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'dryRun requires sync', {
          field: 'dryRun',
        });
      }
      if (sync) {
        const deps = buildReckoningDeps({
          db: fastify.db,
          pool: fastify.pg,
          boss: fastify.boss,
          clock: opts.clock,
          log: request.log,
          config: opts.config,
        });
        try {
          const result = await runReckoning(deps, { weekId, dryRun });
          request.log.info(
            { weekId, dryRun, flips: result.flips, hexesProcessed: result.hexesProcessed },
            dryRun ? 'admin reckoning previewed' : 'admin reckoning ran',
          );
          return await reply.code(200).send(result);
        } catch (err) {
          if (isReckoningError(err)) {
            const details =
              err.name === 'WeekNotEndedError'
                ? { endsAt: (err as { endsAt: Date }).endsAt.toISOString() }
                : err.name === 'OutOfOrderError'
                  ? { expectedWeekId: (err as { expectedWeekId: string }).expectedWeekId }
                  : { weekId: (err as { weekId: string | null }).weekId };
            throw new AppError(err.statusCode, err.code, err.message, details);
          }
          throw err;
        }
      }
      const boss = fastify.boss;
      if (boss === null) {
        throw new AppError(503, ERROR_CODES.JOBS_DISABLED, 'Jobs are disabled on this server');
      }
      const jobId = await boss.send(
        RECKONING_WEEKLY,
        { weekId },
        { singletonKey: RECKONING_SINGLETON_KEY },
      );
      if (jobId === null) {
        throw new AppError(
          409,
          ERROR_CODES.RECKONING_RUNNING,
          'A reckoning job is already queued',
          {
            weekId,
          },
        );
      }
      request.log.info({ weekId, jobId }, 'admin reckoning enqueued');
      return reply.code(202).send({ weekId, status: 'queued', jobId });
    },
  );

  fastify.get(
    '/v1/admin/reckonings/:weekId',
    {
      preHandler: adminOnly,
      attachValidation: true,
      schema: {
        tags: ['admin'],
        operationId: 'getReckoning',
        summary: "Status of one week's reckoning",
        description:
          'Role `admin` only. The stored run state, including the resume stage and cursor progress.',
        security,
        params: WeekIdParamsSchema,
        response: {
          200: { ...ReckoningStatusRef, description: 'Reckoning status' },
          401: unauthorized,
          403: forbidden,
          404: { ...ErrorRef, description: 'No reckoning for this week (RECKONING_NOT_FOUND)' },
        },
      },
    },
    async (request) => {
      rejectInvalid(request);
      const { weekId } = request.params;
      const rows = await fastify.db.execute<StatusRow>(sql`
        select week_id, status, stage, attempt, started_at, finished_at, hexes_processed, flips,
               parent_flips, batches, walks_autofinished, push_queued, error
        from reckonings where week_id = ${weekId}
      `);
      const row = rows.rows[0];
      if (!row) {
        throw new AppError(404, ERROR_CODES.RECKONING_NOT_FOUND, `No reckoning for ${weekId}`, {
          weekId,
        });
      }
      const status: ReckoningStatus = {
        weekId: row.week_id,
        status: row.status,
        stage: row.stage,
        attempt: Number(row.attempt),
        startedAt: iso(row.started_at),
        finishedAt: row.finished_at === null ? null : iso(row.finished_at),
        hexesProcessed: Number(row.hexes_processed),
        flips: Number(row.flips),
        parentFlips: Number(row.parent_flips),
        batches: Number(row.batches),
        walksAutofinished: Number(row.walks_autofinished),
        pushQueued: Number(row.push_queued),
        error: row.error,
      };
      return status;
    },
  );

  done();
};
