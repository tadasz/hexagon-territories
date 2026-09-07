import type { FastifyPluginCallbackTypebox } from '@fastify/type-provider-typebox';
import { and, desc, eq } from 'drizzle-orm';
import type { AppConfig } from '../../config.js';
import { accountExports, users } from '../../db/schema/index.js';
import { ACCOUNT_EXPORT, accountExportSendOptions } from '../../jobs/account-export.js';
import { ACCOUNT_PURGE, accountPurgeSendOptions } from '../../jobs/account-purge.js';
import { addDays, type Clock } from '../../lib/time.js';
import { ErrorRef } from '../../schemas/error.js';
import { revokeAllForUser } from '../auth/tokens.js';
import {
  AccountDeletionRef,
  ExportStatusRef,
  FactionSelectRef,
  MeRef,
  MeUpdateRef,
  type ExportStatus,
} from './schemas.js';
import { getMe, selectFaction, updateDisplayName } from './service.js';

export interface MeRoutesOptions {
  config: Pick<AppConfig, 'account'>;
  clock: Clock;
}

/** A `failed` export is shown for this long before a new request builds a fresh bundle. */
export const FAILED_EXPORT_VISIBLE_MS = 60_000;

const unauthorized = {
  ...ErrorRef,
  description:
    'Missing or invalid access token (UNAUTHORIZED), expired token (TOKEN_EXPIRED) or deleted account (ACCOUNT_DELETED)',
};
const badRequest = {
  ...ErrorRef,
  description: 'Request validation failed (code VALIDATION_FAILED)',
};

/** `/v1/me*` (contracts/openapi.yaml, tag `me`); every route needs a bearer token. */
export const meRoutes: FastifyPluginCallbackTypebox<MeRoutesOptions> = (fastify, opts, done) => {
  const security = [{ bearerAuth: [] }];

  fastify.get(
    '/v1/me',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['me'],
        operationId: 'getMe',
        summary: "The signed-in player's profile",
        description:
          'Includes `suggestedFactionId` so the faction pick screen needs no second call. Never returns the e-mail address.',
        security,
        response: { 200: { ...MeRef, description: 'Profile' }, 401: unauthorized },
      },
    },
    async (request) => getMe(fastify.db, opts.clock, request.user!.id),
  );

  fastify.patch(
    '/v1/me',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['me'],
        operationId: 'updateMe',
        summary: 'Update the display name',
        description:
          'The display name is trimmed, must be 2–24 Unicode scalars long and contain no control characters. Violations answer 400 VALIDATION_FAILED with `details.field = "displayName"` and `details.rule` in tooShort | tooLong | controlCharacter.',
        security,
        body: MeUpdateRef,
        response: {
          200: { ...MeRef, description: 'Updated profile' },
          400: badRequest,
          401: unauthorized,
        },
      },
    },
    async (request) =>
      updateDisplayName(fastify.db, opts.clock, request.user!.id, request.body.displayName),
  );

  fastify.delete(
    '/v1/me',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['me'],
        operationId: 'deleteMe',
        summary: 'Delete the account (30-day grace period)',
        description:
          'Marks the account deleted, revokes every refresh token and schedules erasure 30 days later (`account.purge`). Signing in with the same Apple ID before `purgeAt` restores the account. After this call every request with the old credentials answers 401 ACCOUNT_DELETED.',
        security,
        response: {
          200: { ...AccountDeletionRef, description: 'Deletion accepted' },
          401: unauthorized,
        },
      },
    },
    async (request) => {
      const userId = request.user!.id;
      const deletedAt = opts.clock.now();
      const purgeAt = addDays(deletedAt, opts.config.account.purgeGraceDays);
      await fastify.db.transaction(async (tx) => {
        await tx.update(users).set({ deletedAt }).where(eq(users.id, userId));
        await revokeAllForUser(tx, userId, opts.clock);
      });
      if (fastify.boss) {
        try {
          await fastify.boss.send(
            ACCOUNT_PURGE,
            { userId, deletedAt: deletedAt.toISOString() },
            accountPurgeSendOptions(purgeAt, userId),
          );
        } catch (err) {
          request.log.error(
            { err, userId },
            'account.purge could not be enqueued; run job:purge manually',
          );
        }
      } else {
        request.log.warn(
          { userId },
          'jobs disabled: account.purge not scheduled; run job:purge manually',
        );
      }
      request.log.info({ userId, purgeAt: purgeAt.toISOString() }, 'account marked deleted');
      return { deletedAt: deletedAt.toISOString(), purgeAt: purgeAt.toISOString() };
    },
  );

  fastify.post(
    '/v1/me/faction',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['me'],
        operationId: 'selectFaction',
        summary: 'Pick or change the faction',
        description:
          'The first pick is free and starts no lock. Re-selecting the current faction is a no-op. A change is allowed when the player has never changed or the previous change is at least 30 days old; otherwise 409 FACTION_CHANGE_LOCKED with `details.nextChangeAt`. XP and level are never altered.',
        security,
        body: FactionSelectRef,
        response: {
          200: {
            ...MeRef,
            description:
              'Updated profile (with `factionChangeAvailableAt` and `suggestedFactionId`)',
          },
          400: badRequest,
          401: unauthorized,
          404: { ...ErrorRef, description: 'Unknown faction id (code FACTION_NOT_FOUND)' },
          409: {
            ...ErrorRef,
            description:
              'Faction change locked (code FACTION_CHANGE_LOCKED, `details.nextChangeAt` ISO 8601)',
          },
        },
      },
    },
    async (request) =>
      selectFaction(fastify.db, opts.clock, request.user!.id, request.body.factionId),
  );

  fastify.get(
    '/v1/me/export',
    {
      preHandler: [fastify.authenticate],
      schema: {
        tags: ['me'],
        operationId: 'getExport',
        summary: "Request or poll the player's data export",
        description:
          'Returns the latest export when it is pending, ready and not older than 7 days (with a fresh `downloadUrl` valid for one hour), or failed less than a minute ago (so the failure is visible). Otherwise enqueues a new export (`account.export`) and answers 202 with `status: pending`. Clients poll every 5 seconds while pending.',
        security,
        response: {
          200: { ...ExportStatusRef, description: 'Existing export (pending, ready or failed)' },
          202: { ...ExportStatusRef, description: 'A new export was enqueued' },
          401: unauthorized,
        },
      },
    },
    async (request, reply) => {
      const userId = request.user!.id;
      const now = opts.clock.now();
      const [latest] = await fastify.db
        .select()
        .from(accountExports)
        .where(and(eq(accountExports.userId, userId)))
        .orderBy(desc(accountExports.requestedAt))
        .limit(1);

      const reusable =
        latest !== undefined &&
        (latest.status === 'pending' ||
          (latest.status === 'ready' &&
            latest.expiresAt !== null &&
            latest.expiresAt.getTime() > now.getTime()) ||
          (latest.status === 'failed' &&
            latest.completedAt !== null &&
            now.getTime() - latest.completedAt.getTime() < FAILED_EXPORT_VISIBLE_MS));

      if (latest && reusable) {
        const downloadUrl =
          latest.status === 'ready' && latest.objectKey
            ? await fastify.storage.presignGet(latest.objectKey, opts.config.account.exportUrlTtlS)
            : null;
        return toExportStatus(latest, downloadUrl);
      }

      const [created] = await fastify.db
        .insert(accountExports)
        .values({ userId, requestedAt: now })
        .returning();
      if (!created) throw new Error('insert returned no row');
      if (fastify.boss) {
        await fastify.boss.send(
          ACCOUNT_EXPORT,
          { exportId: created.id, userId },
          accountExportSendOptions(created.id),
        );
      } else {
        request.log.warn(
          { exportId: created.id },
          'jobs disabled: account.export not enqueued; run job:export manually',
        );
      }
      request.log.info({ userId, exportId: created.id }, 'export requested');
      return reply.code(202).send(toExportStatus(created, null));
    },
  );

  done();
};

function toExportStatus(
  row: typeof accountExports.$inferSelect,
  downloadUrl: string | null,
): ExportStatus {
  return {
    id: row.id,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    downloadUrl,
    error: row.error,
  };
}
