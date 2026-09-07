import { and, desc, eq, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client.js';
import { walkSessions } from '../../db/schema/index.js';
import { AppError, ERROR_CODES } from '../../errors.js';
import type { AuthUser } from '../../plugins/auth.js';
import { finishWalk, lastAcceptedSampleTs } from './finish.js';
import { clampStartedAt } from './limits.js';
import type { WalkCreateRequest, WalkCreated } from './schemas.js';

export interface CreateWalkResult {
  /** True for 201, false when `(user, clientWalkId)` already existed (200). */
  created: boolean;
  walk: WalkCreated;
}

/**
 * `POST /v1/walks` (research.md R3; plan.md Shared Semantics 3): needs a faction; idempotent on
 * `(user, clientWalkId)`; `startedAt` clamped to `[now − 12 h, now + 5 min]`; a still-active
 * walk whose last activity precedes the new start is finished as `superseded` in the same
 * transaction, a genuinely overlapping one answers 409 WALK_OVERLAP. The player's row is locked
 * so two creations never both pass the active-walk check.
 */
export async function createWalk(
  tx: Tx,
  user: Pick<AuthUser, 'id' | 'factionId'>,
  body: WalkCreateRequest,
  now: Date,
): Promise<CreateWalkResult> {
  if (user.factionId === null) {
    throw new AppError(403, ERROR_CODES.FACTION_REQUIRED, 'Pick a faction before walking');
  }
  await tx.execute(sql`select id from users where id = ${user.id} for update`);

  const [existing] = await tx
    .select({
      id: walkSessions.id,
      clientWalkId: walkSessions.clientWalkId,
      startedAt: walkSessions.startedAt,
      status: walkSessions.status,
    })
    .from(walkSessions)
    .where(and(eq(walkSessions.userId, user.id), eq(walkSessions.clientWalkId, body.clientWalkId)))
    .limit(1);
  if (existing) {
    return {
      created: false,
      walk: {
        walkId: existing.id,
        clientWalkId: existing.clientWalkId,
        startedAt: existing.startedAt.toISOString(),
        status: existing.status,
        supersededWalkId: null,
      },
    };
  }

  const startedAt = clampStartedAt(new Date(body.startedAt), now);
  let supersededWalkId: string | null = null;
  const [active] = await tx
    .select({ id: walkSessions.id, startedAt: walkSessions.startedAt })
    .from(walkSessions)
    .where(and(eq(walkSessions.userId, user.id), eq(walkSessions.status, 'active')))
    .orderBy(desc(walkSessions.startedAt))
    .limit(1);
  if (active) {
    const lastAccepted = await lastAcceptedSampleTs(tx, active.id);
    const lastActivity = new Date(
      Math.max(active.startedAt.getTime(), lastAccepted?.getTime() ?? 0),
    );
    if (startedAt.getTime() > lastActivity.getTime()) {
      await finishWalk(tx, { walkId: active.id, endedAt: lastActivity, reason: 'superseded', now });
      supersededWalkId = active.id;
    } else {
      throw new AppError(
        409,
        ERROR_CODES.WALK_OVERLAP,
        'The player already has an active walk covering this time; finish it first',
        { activeWalkId: active.id, lastActivityAt: lastActivity.toISOString() },
      );
    }
  }

  const [row] = await tx
    .insert(walkSessions)
    .values({
      userId: user.id,
      clientWalkId: body.clientWalkId,
      factionId: user.factionId,
      startedAt,
      status: 'active',
      ...(body.deviceInfo ? { deviceInfo: body.deviceInfo } : {}),
    })
    .returning({ id: walkSessions.id, startedAt: walkSessions.startedAt });
  if (!row) throw new Error('walk insert returned no row');
  return {
    created: true,
    walk: {
      walkId: row.id,
      clientWalkId: body.clientWalkId,
      startedAt: row.startedAt.toISOString(),
      status: 'active',
      supersededWalkId,
    },
  };
}
