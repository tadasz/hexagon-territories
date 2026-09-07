import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
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
    // feature 004: the reckoning's second idempotency guard (research.md R4)
    index('hex_state_last_reckoned_idx').on(t.lastReckonedWeek),
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

/** Stages of one week's reckoning, in order (specs/004-weekly-reckoning/research.md R1). */
export const RECKONING_STAGES = ['walks', 'cells', 'rollup', 'push', 'done'] as const;
export type ReckoningStage = (typeof RECKONING_STAGES)[number];

/**
 * One row per reckoned ISO week. Feature 004 adds the resume state (`stage`, `cursor_h3_r9`,
 * `attempt`) and the per-stage counts (specs/004-weekly-reckoning/data-model.md §1.1).
 */
export const reckonings = pgTable('reckonings', {
  weekId: text('week_id').primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  hexesProcessed: integer('hexes_processed').notNull().default(0),
  flips: integer('flips').notNull().default(0),
  status: reckoningStatusEnum('status').notNull().default('running'),
  stage: text('stage').$type<ReckoningStage>().notNull().default('walks'),
  cursorH3R9: bigint('cursor_h3_r9', { mode: 'bigint' }),
  batches: integer('batches').notNull().default(0),
  parentFlips: integer('parent_flips').notNull().default(0),
  walksAutofinished: integer('walks_autofinished').notNull().default(0),
  pushQueued: integer('push_queued').notNull().default(0),
  error: text('error'),
  attempt: integer('attempt').notNull().default(1),
});

/** `[{ factionId, strength }]` sorted by faction id — the rules package's `ReckonResult.strengths`. */
export interface HistoryStrength {
  factionId: number;
  strength: number;
}

/**
 * One row per processed cell per reckoned week: what the hex detail shows as "the last 8
 * reckonings" (specs/004-weekly-reckoning/data-model.md §1.2). `captain_before_user_id` feeds
 * the "lost captaincy" count of the result push.
 */
export const hexReckoningHistory = pgTable(
  'hex_reckoning_history',
  {
    h3R9: bigint('h3_r9', { mode: 'bigint' }).notNull(),
    weekId: text('week_id').notNull(),
    ownerFactionId: smallint('owner_faction_id').references(() => factions.id),
    flipped: boolean('flipped').notNull(),
    fromFaction: smallint('from_faction'),
    toFaction: smallint('to_faction'),
    captainUserId: uuid('captain_user_id').references(() => users.id, { onDelete: 'set null' }),
    captainBeforeUserId: uuid('captain_before_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    strengths: jsonb('strengths')
      .$type<HistoryStrength[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    hadContributions: boolean('had_contributions').notNull().default(false),
    reckonedAt: timestamp('reckoned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'hex_reckoning_history_pkey', columns: [t.h3R9, t.weekId] }),
    index('hex_reckoning_history_week_idx').on(t.weekId),
    index('hex_reckoning_history_captain_before_idx')
      .on(t.weekId, t.captainBeforeUserId)
      .where(sql`flipped`),
  ],
);

export type ConsistencyDriftKind = 'missing' | 'extra' | 'owner' | 'counts';

/** One drift entry of `reckoning_consistency.sample` (data-model.md §1.3). */
export interface ConsistencyDrift {
  h3: string;
  res: number;
  kind: ConsistencyDriftKind;
  expectedOwner: number | null;
  actualOwner: number | null;
  expectedCounts: Record<string, number>;
  actualCounts: Record<string, number>;
}

/** One row per run of the nightly `reckoning.consistency` job (data-model.md §1.3). */
export const reckoningConsistency = pgTable('reckoning_consistency', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  ranAt: timestamp('ran_at', { withTimezone: true }).notNull().defaultNow(),
  parentsChecked: integer('parents_checked').notNull(),
  drifted: integer('drifted').notNull(),
  repaired: integer('repaired').notNull().default(0),
  sample: jsonb('sample')
    .$type<ConsistencyDrift[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
});
