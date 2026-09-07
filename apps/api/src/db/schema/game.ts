import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { ledgerKindEnum } from './enums.js';
import { factions } from './factions.js';
import { users } from './users.js';

export const pointsLedger = pgTable(
  'points_ledger',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    factionId: smallint('faction_id').references(() => factions.id),
    kind: ledgerKindEnum('kind').notNull(),
    points: integer('points').notNull(),
    refType: text('ref_type'),
    refId: text('ref_id'),
    h3R9: bigint('h3_r9', { mode: 'bigint' }),
    weekId: text('week_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('points_ledger_user_created_idx').on(t.userId, t.createdAt.desc()),
    index('points_ledger_week_faction_idx').on(t.weekId, t.factionId),
    index('points_ledger_h3_r9_idx').on(t.h3R9),
    // feature 004: flip XP is awarded once per (player, ownership event) even when a reckoning
    // batch is retried (specs/004-weekly-reckoning/research.md R5).
    uniqueIndex('points_ledger_hex_flip_unique')
      .on(t.userId, t.refId)
      .where(sql`kind = 'hex_flip'`),
  ],
);

/**
 * Streaks are the only rule that uses the player's local time (`tz`, an IANA zone set from the
 * device); weeks and reckonings use UTC.
 */
export const streaks = pgTable('streaks', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  currentDays: integer('current_days').notNull().default(0),
  longestDays: integer('longest_days').notNull().default(0),
  lastActiveDate: date('last_active_date'),
  tz: text('tz').notNull().default('UTC'),
});

export type LeaderboardScope = 'global' | 'faction' | 'hex_r7';

/**
 * Weekly boards frozen by the reckoning's rollup stage. `user_id` is nullable since feature 004:
 * erasing an account anonymises the row (rank and metres kept) instead of deleting it.
 */
export const leaderboardSnapshots = pgTable(
  'leaderboard_snapshots',
  {
    weekId: text('week_id').notNull(),
    scope: text('scope').$type<LeaderboardScope>().notNull(),
    scopeId: text('scope_id').notNull().default(''),
    rank: integer('rank').notNull(),
    userId: uuid('user_id').references(() => users.id),
    meters: real('meters').notNull().default(0),
    points: integer('points').notNull().default(0),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'leaderboard_snapshots_pkey',
      columns: [t.weekId, t.scope, t.scopeId, t.rank],
    }),
    index('leaderboard_snapshots_user_week_idx').on(t.userId, t.weekId),
  ],
);

export const factionStatsWeekly = pgTable(
  'faction_stats_weekly',
  {
    weekId: text('week_id').notNull(),
    factionId: smallint('faction_id')
      .notNull()
      .references(() => factions.id),
    hexesOwnedR9: integer('hexes_owned_r9').notNull().default(0),
    hexesOwnedR7: integer('hexes_owned_r7').notNull().default(0),
    meters: real('meters').notNull().default(0),
    activeUsers: integer('active_users').notNull().default(0),
    captures: integer('captures').notNull().default(0),
  },
  (t) => [primaryKey({ name: 'faction_stats_weekly_pkey', columns: [t.weekId, t.factionId] })],
);
