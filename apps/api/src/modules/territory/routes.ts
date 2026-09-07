import type { FastifyPluginCallbackTypebox } from '@fastify/type-provider-typebox';
import { weekIdFor } from '@nature/territory-rules';
import type { FastifyRequest } from 'fastify';
import type { AppConfig } from '../../config.js';
import { AppError, ERROR_CODES } from '../../errors.js';
import { BboxError, bboxAreaKm2, parseBbox } from '../../lib/geo.js';
import { cellAreaKm2, isRes9Cell } from '../../lib/h3.js';
import type { Clock } from '../../lib/time.js';
import { rejectInvalid } from '../../lib/validation.js';
import { ErrorRef } from '../../schemas/error.js';
import { getHexDetail, listHexes } from './hexes.js';
import { latestReckoning } from './latest.js';
import { HEX_BBOX_MAX_CELLS, HEXES_RATE_PER_MIN } from './limits.js';
import {
  HexDetailRef,
  HexListQuerySchema,
  HexListRef,
  HexParamsSchema,
  ReckoningLatestRef,
} from './schemas.js';

export interface TerritoryRoutesOptions {
  config: Pick<AppConfig, 'territory'>;
  clock: Clock;
}

const unauthorized = {
  ...ErrorRef,
  description:
    'Missing or invalid access token (UNAUTHORIZED), expired token (TOKEN_EXPIRED) or deleted account (ACCOUNT_DELETED)',
};
const rateLimited = {
  ...ErrorRef,
  description:
    'Too many requests (code RATE_LIMITED, `details.retryAfterS`); the `retry-after` header is set',
};

/**
 * `/v1/hexes`, `/v1/hexes/{h3}`, `/v1/reckonings/latest` (specs/004-weekly-reckoning/contracts/
 * openapi.yaml, tag `territory`). Every route needs a bearer token; the list is rate limited per
 * player. All three read: ownership changes only inside `reckoning.weekly`.
 */
export const territoryRoutes: FastifyPluginCallbackTypebox<TerritoryRoutesOptions> = (
  fastify,
  opts,
  done,
) => {
  const security = [{ bearerAuth: [] }];
  const perPlayer = (request: FastifyRequest) => request.user?.id ?? request.ip;
  const listLimiter = fastify.rateLimit({
    max: HEXES_RATE_PER_MIN,
    timeWindow: '1 minute',
    keyGenerator: perPlayer,
  });
  const maxCells = opts.config.territory.bboxMaxCells ?? HEX_BBOX_MAX_CELLS;

  fastify.get(
    '/v1/hexes',
    {
      preHandler: [fastify.authenticate, listLimiter],
      attachValidation: true,
      schema: {
        tags: ['territory'],
        operationId: 'listHexes',
        summary: 'Hexagons of one resolution inside a bounding box',
        description: `Returns every hexagon of resolution \`res\` (5–9) that has a state row and whose polygon intersects \`bbox\`, sorted by cell id. Res 9 rows carry the owner from the last reckoning and this week's pressure read model (\`pressureLeader\`, \`contested\`); res 5–8 rows come from the materialised parent state and carry \`pressureLeader: null\`, \`contested: false\`, \`ownerSince: null\`. Cells that have never been walked are absent. The box may not cross the antimeridian and may not be estimated to contain more than ${String(HEX_BBOX_MAX_CELLS)} hexagons of the requested resolution (400 BBOX_TOO_LARGE). Rate limited: ${String(HEXES_RATE_PER_MIN)} requests per minute per player. Sent with \`Cache-Control: private, max-age=30\`.`,
        security,
        querystring: HexListQuerySchema,
        response: {
          200: { ...HexListRef, description: 'Hexagons in the box' },
          400: {
            ...ErrorRef,
            description:
              'Validation failed (VALIDATION_FAILED; `details.field` is `res` or `bbox`) or the box is too large (BBOX_TOO_LARGE; `details.res`, `details.maxCells`, `details.estimatedCells`)',
          },
          401: unauthorized,
          429: rateLimited,
        },
      },
    },
    async (request, reply) => {
      rejectInvalid(request);
      const { res } = request.query;
      let bbox;
      try {
        bbox = parseBbox(request.query.bbox);
      } catch (err) {
        if (err instanceof BboxError) {
          throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, err.message, { field: err.field });
        }
        throw err;
      }
      const estimatedCells = Math.round(bboxAreaKm2(bbox) / cellAreaKm2(res));
      if (estimatedCells > maxCells) {
        throw new AppError(
          400,
          ERROR_CODES.BBOX_TOO_LARGE,
          `The box holds about ${String(estimatedCells)} hexagons at res ${String(res)}; the limit is ${String(maxCells)}`,
          { res, maxCells, estimatedCells },
        );
      }
      const list = await listHexes(fastify.db, {
        res,
        bbox,
        weekId: weekIdFor(opts.clock.now()),
        limit: maxCells,
      });
      reply.header('cache-control', 'private, max-age=30');
      return list;
    },
  );

  fastify.get(
    '/v1/hexes/:h3',
    {
      preHandler: [fastify.authenticate],
      attachValidation: true,
      schema: {
        tags: ['territory'],
        operationId: 'getHex',
        summary: 'Detail of one resolution-9 hexagon',
        description:
          "Owner and since when, captain, strength per faction, this week's counted metres and bonuses per faction with the pressure leader and contested flag, the caller's own metres and states (`explored`, `flipped`, `held`), the last eight reckonings (newest first) and `captures` (always empty until feature 006). Any valid resolution-9 cell answers 200 — a never-walked cell has no owner, no strengths and no history.",
        security,
        params: HexParamsSchema,
        response: {
          200: { ...HexDetailRef, description: 'Hex detail' },
          400: {
            ...ErrorRef,
            description: 'Not a resolution-9 cell (VALIDATION_FAILED, `details.field = h3`)',
          },
          401: unauthorized,
        },
      },
    },
    async (request, reply) => {
      rejectInvalid(request);
      const { h3 } = request.params;
      if (!isRes9Cell(h3)) {
        throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, 'h3 is not a resolution-9 cell', {
          field: 'h3',
        });
      }
      const detail = await getHexDetail(fastify.db, h3, weekIdFor(opts.clock.now()), {
        id: request.user!.id,
      });
      reply.header('cache-control', 'private, max-age=30');
      return detail;
    },
  );

  fastify.get(
    '/v1/reckonings/latest',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['territory'],
        operationId: 'getLatestReckoning',
        summary: 'The last completed reckoning and the caller’s part in it',
        description:
          'Week id and run time of the last completed reckoning, when the next one is due (next Monday 00:00 UTC), whether one is in progress, per-faction totals of that week and the caller’s flip count with the flipped cell ids. Before the first reckoning the week fields are null and the totals empty. Sent with `Cache-Control: private, max-age=60`.',
        security,
        response: {
          200: { ...ReckoningLatestRef, description: 'Latest reckoning' },
          401: unauthorized,
        },
      },
    },
    async (request, reply) => {
      const latest = await latestReckoning(fastify.db, opts.clock.now(), { id: request.user!.id });
      reply.header('cache-control', 'private, max-age=60');
      return latest;
    },
  );

  done();
};
