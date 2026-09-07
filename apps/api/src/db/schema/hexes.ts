import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { reckoningStatusEnum } from './enums.js';
import { factions } from './factions.js';
import { geometryPolygon } from './postgis.js';
import { users } from './users.js';

/** Per-player, per-faction metres in a res-9 cell for one ISO week (UTC). Written by finishWalk. */
export const hexWeekContribution = pgTable(
  'hex_week_contribution',
  {
    h3R9: bigint('h3_r9', { mode: 'bigint' }).notNull(),
    weekId: text('week_id').notNull(),
    factionId: smallint('faction_id')
      .notNull()
      .references(() => factions.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    meters: real('meters').notNull().default(0),
    cappedMeters: real('capped_meters').notNull().default(0),
    captureBonusM: real('capture_bonus_m').notNull().default(0),
    walks: integer('walks').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'hex_week_contribution_pkey',
      columns: [t.h3R9, t.weekId, t.factionId, t.userId],
    }),
    index('hex_week_contribution_week_h3_idx').on(t.weekId, t.h3R9),
    index('hex_week_contribution_user_week_idx').on(t.userId, t.weekId),
  ],
);

/** Decayed, accumulated strength per faction per cell. Updated only by reckoning.weekly. */
export const hexFactionStrength = pgTable(
  'hex_faction_strength',
  {
    h3R9: bigint('h3_r9', { mode: 'bigint' }).notNull(),
    factionId: smallint('faction_id')
      .notNull()
      .references(() => factions.id),
    strength: real('strength').notNull().default(0),
    lastReckonedWeek: text('last_reckoned_week'),
  },
  (t) => [primaryKey({ name: 'hex_faction_strength_pkey', columns: [t.h3R9, t.factionId] })],
);

/**
 * Ownership of a res-9 cell. `owner_faction_id` is written only by the `reckoning.weekly` job
 * (Constitution II). Parents are precomputed so rollups never depend on h3-pg; `geom` is stored so
 * PostGIS bbox/MVT queries need no extension at read time.
 */
export const hexState = pgTable(
  'hex_state',
  {
    h3R9: bigint('h3_r9', { mode: 'bigint' }).primaryKey(),
    h3R8: bigint('h3_r8', { mode: 'bigint' }).notNull(),
    h3R7: bigint('h3_r7', { mode: 'bigint' }).notNull(),
    h3R6: bigint('h3_r6', { mode: 'bigint' }).notNull(),
    h3R5: bigint('h3_r5', { mode: 'bigint' }).notNull(),
    geom: geometryPolygon('geom').notNull(),
    ownerFactionId: smallint('owner_faction_id').references(() => factions.id),
    ownerSinceWeek: text('owner_since_week'),
    captainUserId: uuid('captain_user_id').references(() => users.id, { onDelete: 'set null' }),
    lastReckonedWeek: text('last_reckoned_week'),
    lastActivityWeek: text('last_activity_week'),
    version: integer('version').notNull().default(0),
  },
  (t) => [
    index('hex_state_h3_r8_idx').on(t.h3R8),
    index('hex_state_h3_r7_idx').on(t.h3R7),
    index('hex_state_h3_r6_idx').on(t.h3R6),
    index('hex_state_h3_r5_idx').on(t.h3R5),
    index('hex_state_geom_gist').using('gist', t.geom),
    index('hex_state_owner_faction_id_idx').on(t.ownerFactionId),
  ],
);

export const hexOwnershipEvents = pgTable(
  'hex_ownership_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    h3R9: bigint('h3_r9', { mode: 'bigint' }).notNull(),
    weekId: text('week_id').notNull(),
    fromFaction: smallint('from_faction'),
    toFaction: smallint('to_faction'),
    cause: text('cause').notNull(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('hex_ownership_events_h3_at_idx').on(t.h3R9, t.at.desc()),
    index('hex_ownership_events_week_id_idx').on(t.weekId),
  ],
);

/** Materialised res 8-5 parents for the map; derived from child owners at reckoning. */
export const hexParentState = pgTable(
  'hex_parent_state',
  {
    h3: bigint('h3', { mode: 'bigint' }).primaryKey(),
    res: smallint('res').notNull(),
    geom: geometryPolygon('geom').notNull(),
    ownerFactionId: smallint('owner_faction_id').references(() => factions.id),
    childOwnerCounts: jsonb('child_owner_counts')
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    claimedChildren: integer('claimed_children').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('hex_parent_state_res_idx').on(t.res),
    index('hex_parent_state_geom_gist').using('gist', t.geom),
    index('hex_parent_state_owner_faction_id_idx').on(t.ownerFactionId),
  ],
);

export const reckonings = pgTable('reckonings', {
  weekId: text('week_id').primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  hexesProcessed: integer('hexes_processed').notNull().default(0),
  flips: integer('flips').notNull().default(0),
  status: reckoningStatusEnum('status').notNull().default('running'),
});
