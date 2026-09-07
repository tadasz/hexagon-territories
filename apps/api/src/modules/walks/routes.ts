import type { FastifyPluginCallbackTypebox } from '@fastify/type-provider-typebox';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { AppConfig } from '../../config.js';
import { walkSessions } from '../../db/schema/index.js';
import { AppError, ERROR_CODES } from '../../errors.js';
import type { Clock } from '../../lib/time.js';
import { ErrorRef } from '../../schemas/error.js';
import { decodeCursor, encodeCursor } from './cursor.js';
import { finishWalk } from './finish.js';
import { BATCH_WINDOW, WALKS_PER_HOUR } from './limits.js';
import { storeBatch } from './samples.js';
import {
  SampleBatchRequestRef,
  SampleBatchResultRef,
  WalkCreateRequestRef,
  WalkCreatedRef,
  WalkFinishRequestRef,
  WalkIdParamsSchema,
  WalkListPageRef,
  WalkListQuerySchema,
  WalkSummaryRef,
} from './schemas.js';
import { createWalk } from './service.js';
import { loadSummary, summaryColumns, toListItem } from './summary.js';

export interface WalksRoutesOptions {
  config: Pick<AppConfig, 'walks'>;
  clock: Clock;
}

const unauthorized = {
  ...ErrorRef,
  description:
    'Missing or invalid access token (UNAUTHORIZED), expired token (TOKEN_EXPIRED) or deleted account (ACCOUNT_DELETED)',
};
const badRequest = {
  ...ErrorRef,
  description:
    'Request validation failed (code VALIDATION_FAILED; `details.field` names the offending field, e.g. `samples` for a batch over 200 or `cursor` for a malformed cursor)',
};
const walkNotFound = {
  ...ErrorRef,
  description:
    'Unknown walk id or a walk that belongs to another player (code WALK_NOT_FOUND; never distinguishes the two)',
};
const rateLimited = {
  ...ErrorRef,
  description:
    'Too many requests (code RATE_LIMITED, `details.retryAfterS`); the `retry-after` header is set',
};

interface ValidationIssue {
  instancePath: string;
  keyword: string;
  message?: string;
  params?: unknown;
}

/** `details.field` of the first validation issue (`/samples/3/lat` → `samples`). */
function fieldOf(issues: readonly ValidationIssue[]): string | undefined {
  const issue = issues[0];
  if (!issue) return undefined;
  const path = issue.instancePath.replace(/^\//, '').split('/')[0];
  if (path) return path;
  const params = issue.params as { missingProperty?: unknown } | undefined;
  return typeof params?.missingProperty === 'string' ? params.missingProperty : undefined;
}

/** With `attachValidation`, rethrows a validation failure as the envelope with `details.field`. */
function rejectInvalid(request: FastifyRequest): void {
  const error = request.validationError;
  if (!error) return;
  const issues = (Array.isArray(error.validation) ? error.validation : []) as ValidationIssue[];
  const field = fieldOf(issues);
  throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, error.message, {
    ...(field ? { field } : {}),
    context: error.validationContext,
    issues: issues.map((issue) => ({
      path: issue.instancePath,
      keyword: issue.keyword,
      message: issue.message,
      params: issue.params,
    })),
  });
}

/**
 * `/v1/walks*` (specs/003-walk-tracking/contracts/openapi.yaml, tag `walks`). Every route needs a
 * bearer token; the ingest limits are keyed by player (a `preHandler` limiter after
 * `authenticate`, since the plugin's `onRequest` hook runs before the user is known).
 */
export const walksRoutes: FastifyPluginCallbackTypebox<WalksRoutesOptions> = (
  fastify,
  opts,
  done,
) => {
  const security = [{ bearerAuth: [] }];
  const perPlayer = (request: FastifyRequest) => request.user?.id ?? request.ip;
  const createLimiter = fastify.rateLimit({
    max: WALKS_PER_HOUR,
    timeWindow: '1 hour',
    keyGenerator: perPlayer,
  });
  const batchLimiter = fastify.rateLimit({
    max: opts.config.walks.ingestBatchesPer15Min,
    timeWindow: BATCH_WINDOW,
    keyGenerator: perPlayer,
  });

  fastify.post(
    '/v1/walks',
    {
      preHandler: [fastify.authenticate, createLimiter],
      attachValidation: true,
      schema: {
        tags: ['walks'],
        operationId: 'createWalk',
        summary: 'Start a walk (idempotent on clientWalkId)',
        description:
          'Creates the walk for `(player, clientWalkId)`; repeating the call returns the same walk with 200 (and its current status). `startedAt` is clamped to [now − 12 h, now + 5 min]. If the player has an active walk whose last activity precedes `startedAt`, that walk is finished automatically (`supersededWalkId`, reason `superseded`); if the ranges overlap the request is refused with 409 WALK_OVERLAP. Players without a faction cannot start walks (403 FACTION_REQUIRED). Rate limited: 20 creations per hour per player.',
        security,
        body: WalkCreateRequestRef,
        response: {
          201: { ...WalkCreatedRef, description: 'Walk created' },
          200: { ...WalkCreatedRef, description: 'Walk already existed for this clientWalkId' },
          400: badRequest,
          401: unauthorized,
          403: {
            ...ErrorRef,
            description: 'The player has no faction yet (code FACTION_REQUIRED)',
          },
          409: {
            ...ErrorRef,
            description:
              "Overlaps the player's active walk (code WALK_OVERLAP, `details.activeWalkId`)",
          },
          429: rateLimited,
        },
      },
    },
    async (request, reply) => {
      rejectInvalid(request);
      const now = opts.clock.now();
      const result = await fastify.db.transaction((tx) =>
        createWalk(tx, request.user!, request.body, now),
      );
      request.log.info(
        {
          walkId: result.walk.walkId,
          created: result.created,
          superseded: result.walk.supersededWalkId,
        },
        result.created ? 'walk created' : 'walk creation repeated',
      );
      return reply.code(result.created ? 201 : 200).send(result.walk);
    },
  );

  fastify.get(
    '/v1/walks',
    {
      preHandler: [fastify.authenticate],
      attachValidation: true,
      schema: {
        tags: ['walks'],
        operationId: 'listWalks',
        summary: "The player's walks, newest first",
        description:
          "Cursor pagination over the caller's own walks ordered by start time descending. `nextCursor` is opaque; pass it back to get the next page; null when exhausted. List items carry no path and no per-hex rows (use GET /v1/walks/{id}).",
        security,
        querystring: WalkListQuerySchema,
        response: {
          200: { ...WalkListPageRef, description: 'One page' },
          400: badRequest,
          401: unauthorized,
        },
      },
    },
    async (request) => {
      rejectInvalid(request);
      const userId = request.user!.id;
      const limit = request.query.limit ?? 20;
      const cursor = request.query.cursor ? decodeCursor(request.query.cursor) : undefined;
      const rows = await fastify.db
        .select(summaryColumns)
        .from(walkSessions)
        .where(
          and(
            eq(walkSessions.userId, userId),
            cursor
              ? sql`(${walkSessions.startedAt}, ${walkSessions.id}) < (${cursor.startedAt}::timestamptz, ${cursor.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(walkSessions.startedAt), desc(walkSessions.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map(toListItem),
        nextCursor:
          rows.length > limit && last
            ? encodeCursor({ startedAt: last.startedAt, id: last.id })
            : null,
      };
    },
  );

  fastify.post(
    '/v1/walks/:id/samples',
    {
      preHandler: [fastify.authenticate, batchLimiter],
      attachValidation: true,
      schema: {
        tags: ['walks'],
        operationId: 'uploadWalkSamples',
        summary: 'Upload a batch of raw location samples (store only)',
        description:
          'Stores up to 200 samples idempotently by `(walk, seq)`: re-delivered or reordered batches never duplicate rows and never change the final score. The answer reports how many rows were new and a **provisional** result of the shared sample filter (accuracy > 50 m, speed > 5 m/s, non-monotonic timestamp); the finish step re-runs the filter over all stored samples. Nothing is scored here. Rate limited: 30 batches per 15 minutes per player (2 per minute average) and 8 640 stored samples per UTC day.',
        security,
        params: WalkIdParamsSchema,
        body: SampleBatchRequestRef,
        response: {
          200: { ...SampleBatchResultRef, description: 'Batch stored' },
          400: badRequest,
          401: unauthorized,
          404: walkNotFound,
          409: { ...ErrorRef, description: 'The walk is no longer active (code WALK_NOT_ACTIVE)' },
          429: {
            ...ErrorRef,
            description:
              'Batch rate limit (RATE_LIMITED) or daily sample quota (SAMPLE_QUOTA_EXCEEDED); `details.retryAfterS` and the `retry-after` header say how long to wait',
          },
        },
      },
    },
    async (request) => {
      rejectInvalid(request);
      const now = opts.clock.now();
      return fastify.db.transaction((tx) =>
        storeBatch(tx, {
          walkId: request.params.id,
          userId: request.user!.id,
          body: request.body,
          now,
          samplesPerDay: opts.config.walks.samplesPerDay,
        }),
      );
    },
  );

  fastify.post(
    '/v1/walks/:id/finish',
    {
      preHandler: [fastify.authenticate],
      attachValidation: true,
      schema: {
        tags: ['walks'],
        operationId: 'finishWalk',
        summary: 'Finish the walk and score it (the only scoring path)',
        description:
          "In one transaction: re-run the sample filter over every stored sample, compute walk flags, simplify the accepted path (5 m), split it into resolution-9 cells, store the path and per-cell metres, set `weekId` to the ISO week (UTC) of the clamped end time (max(last accepted sample, min(endedAt, now))). Unflagged walks credit the player's faction per cell for the week (2 000 m cap per player per cell per week) and award 1 XP per 100 m (300 XP per day cap). Flagged walks store everything but credit nothing (`scored: false`, every `cappedMeters` 0, `xp` 0). Calling finish on an already finished walk returns the stored summary unchanged.",
        security,
        params: WalkIdParamsSchema,
        body: WalkFinishRequestRef,
        response: {
          200: { ...WalkSummaryRef, description: 'Authoritative summary' },
          400: {
            ...ErrorRef,
            description:
              'Validation failed, or `endedAt` before `startedAt` (code INVALID_ENDED_AT)',
          },
          401: unauthorized,
          404: walkNotFound,
        },
      },
    },
    async (request) => {
      rejectInvalid(request);
      const now = opts.clock.now();
      const userId = request.user!.id;
      const walkId = request.params.id;
      const endedAt = new Date(request.body.endedAt);
      const summary = await fastify.db.transaction(async (tx) => {
        const [walk] = await tx
          .select({ status: walkSessions.status, startedAt: walkSessions.startedAt })
          .from(walkSessions)
          .where(and(eq(walkSessions.id, walkId), eq(walkSessions.userId, userId)))
          .for('update');
        if (!walk) throw new AppError(404, ERROR_CODES.WALK_NOT_FOUND, 'Walk not found');
        if (walk.status === 'active' && endedAt.getTime() < walk.startedAt.getTime()) {
          throw new AppError(400, ERROR_CODES.INVALID_ENDED_AT, 'endedAt is before startedAt', {
            field: 'endedAt',
            startedAt: walk.startedAt.toISOString(),
          });
        }
        return finishWalk(tx, {
          walkId,
          endedAt,
          reason: 'client',
          now,
          pedometerTotal: request.body.pedometerTotal,
          xpDailyCap: opts.config.walks.xpDailyCap,
        });
      });
      request.log.info(
        {
          walkId,
          status: summary.status,
          finishReason: summary.finishReason,
          weekId: summary.weekId,
          distanceM: summary.distanceM,
          hexCount: summary.hexCount,
          xp: summary.xp,
          flags: summary.flags,
        },
        'walk finished',
      );
      return summary;
    },
  );

  fastify.get(
    '/v1/walks/:id',
    {
      preHandler: [fastify.authenticate],
      attachValidation: true,
      schema: {
        tags: ['walks'],
        operationId: 'getWalk',
        summary: "One of the player's walks with its path and per-hex metres",
        description: 'Only the owner can read a walk; any other id answers 404 WALK_NOT_FOUND.',
        security,
        params: WalkIdParamsSchema,
        response: {
          200: {
            ...WalkSummaryRef,
            description:
              'Walk detail (same shape as the finish summary; `hexes` empty and `path` null while active)',
          },
          401: unauthorized,
          404: walkNotFound,
        },
      },
    },
    async (request) => {
      rejectInvalid(request);
      const summary = await loadSummary(fastify.db, request.params.id, request.user!.id);
      if (!summary) throw new AppError(404, ERROR_CODES.WALK_NOT_FOUND, 'Walk not found');
      return summary;
    },
  );

  done();
};
