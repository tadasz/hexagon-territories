import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { factions, users } from '../../db/schema/index.js';
import { AppError, ERROR_CODES } from '../../errors.js';
import type { Clock } from '../../lib/time.js';
import { canChangeFaction, factionChangeAvailableAt } from '../factions/rules.js';
import { suggestedFactionId } from '../factions/service.js';
import { describeDisplayNameRule, validateDisplayName } from './display-name.js';
import type { Me } from './schemas.js';

/** The `users` columns the profile needs (never the e-mail). */
export interface UserProfileRow {
  id: string;
  displayName: string;
  factionId: number | null;
  factionChangedAt: Date | null;
  xp: number;
  level: number;
  role: Me['role'];
  createdAt: Date;
}

export const profileColumns = {
  id: users.id,
  displayName: users.displayName,
  factionId: users.factionId,
  factionChangedAt: users.factionChangedAt,
  xp: users.xp,
  level: users.level,
  role: users.role,
  createdAt: users.createdAt,
};

export function toMe(row: UserProfileRow, suggested: number, now: Date): Me {
  return {
    id: row.id,
    displayName: row.displayName,
    factionId: row.factionId,
    factionChangedAt: row.factionChangedAt ? row.factionChangedAt.toISOString() : null,
    factionChangeAvailableAt:
      factionChangeAvailableAt(row.factionChangedAt, now)?.toISOString() ?? null,
    xp: row.xp,
    level: row.level,
    role: row.role,
    createdAt: row.createdAt.toISOString(),
    suggestedFactionId: suggested,
  };
}

export async function loadProfile(db: Db, userId: string): Promise<UserProfileRow> {
  const [row] = await db.select(profileColumns).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'Unknown account');
  return row;
}

export async function getMe(db: Db, clock: Clock, userId: string): Promise<Me> {
  const [row, suggested] = await Promise.all([
    loadProfile(db, userId),
    suggestedFactionId(db, clock),
  ]);
  return toMe(row, suggested, clock.now());
}

/** PATCH /v1/me: trims and validates per data-model.md §2.7, stores the trimmed value. */
export async function updateDisplayName(
  db: Db,
  clock: Clock,
  userId: string,
  displayName: string,
): Promise<Me> {
  const result = validateDisplayName(displayName);
  if (!result.ok) {
    throw new AppError(400, ERROR_CODES.VALIDATION_FAILED, describeDisplayNameRule(result.rule), {
      field: 'displayName',
      rule: result.rule,
    });
  }
  await db.update(users).set({ displayName: result.value }).where(eq(users.id, userId));
  return getMe(db, clock, userId);
}

/**
 * POST /v1/me/faction (plan.md Shared Semantics 6): unknown id → 404; same faction → no-op;
 * first pick → set without starting the lock; otherwise allowed only when the previous change is
 * at least 30 days old (else 409 with `details.nextChangeAt`). XP and level are never touched.
 */
export async function selectFaction(
  db: Db,
  clock: Clock,
  userId: string,
  factionId: number,
): Promise<Me> {
  const [faction] = await db
    .select({ id: factions.id })
    .from(factions)
    .where(eq(factions.id, factionId))
    .limit(1);
  if (!faction) {
    throw new AppError(404, ERROR_CODES.FACTION_NOT_FOUND, `Faction ${factionId} does not exist`);
  }

  const now = clock.now();
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ factionId: users.factionId, factionChangedAt: users.factionChangedAt })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    if (!current) throw new AppError(401, ERROR_CODES.UNAUTHORIZED, 'Unknown account');
    if (current.factionId === factionId) return;
    if (current.factionId === null) {
      await tx.update(users).set({ factionId }).where(eq(users.id, userId));
      return;
    }
    if (!canChangeFaction(current.factionChangedAt, now)) {
      const nextChangeAt = factionChangeAvailableAt(current.factionChangedAt, now);
      throw new AppError(
        409,
        ERROR_CODES.FACTION_CHANGE_LOCKED,
        'Faction can be changed once every 30 days',
        { nextChangeAt: nextChangeAt?.toISOString() ?? null },
      );
    }
    await tx.update(users).set({ factionId, factionChangedAt: now }).where(eq(users.id, userId));
  });

  return getMe(db, clock, userId);
}
