import type { FastifyPluginCallbackTypebox } from '@fastify/type-provider-typebox';
import type { Clock } from '../../lib/time.js';
import { ErrorRef } from '../../schemas/error.js';
import { FactionsResponseRef } from './schemas.js';
import { getFactionsResponse } from './service.js';

export interface FactionsRoutesOptions {
  clock: Clock;
}

/** Seconds for `Cache-Control: public, max-age` on `GET /v1/factions` (plan.md Performance Goals). */
export const FACTIONS_CACHE_MAX_AGE_S = 60;

export const factionsRoutes: FastifyPluginCallbackTypebox<FactionsRoutesOptions> = (
  fastify,
  opts,
  done,
) => {
  fastify.get(
    '/v1/factions',
    {
      schema: {
        tags: ['factions'],
        operationId: 'listFactions',
        summary: 'The three factions with live statistics and the suggested faction',
        description:
          'No session required. Statistics are computed live: members and active members (used the app within `activeWindowDays`, not deleted, has a faction) from the player table, hexes owned at resolution 9 and 7 from the territory tables (zero until the first reckoning). `suggestedFactionId` is the faction with the fewest active members, ties broken by the lowest id. Sent with `Cache-Control: public, max-age=60`.',
        security: [],
        response: {
          200: { ...FactionsResponseRef, description: 'Factions sorted by `sort`, then `id`' },
          503: { ...ErrorRef, description: 'Database not reachable (code DB_UNAVAILABLE)' },
        },
      },
    },
    async (_request, reply) => {
      const body = await getFactionsResponse(fastify.db, opts.clock);
      void reply.header('cache-control', `public, max-age=${FACTIONS_CACHE_MAX_AGE_S}`);
      return body;
    },
  );
  done();
};
