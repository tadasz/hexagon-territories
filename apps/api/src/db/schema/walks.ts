import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { walkStatusEnum } from './enums.js';
import { factions } from './factions.js';
import { geographyLineString } from './postgis.js';
import { devices, users } from './users.js';

export type WalkFlag = 'teleport' | 'speed' | 'distance' | 'no_steps';

export const walkSessions = pgTable(
  'walk_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    clientWalkId: uuid('client_walk_id').notNull(),
    factionId: smallint('faction_id').references(() => factions.id),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: walkStatusEnum('status').notNull().default('active'),
    weekId: text('week_id'),
    distanceM: real('distance_m'),
    durationS: integer('duration_s'),
    steps: integer('steps'),
    path: geographyLineString('path'),
    pathSimplified: geographyLineString('path_simplified'),
    sampleCount: integer('sample_count').notNull().default(0),
    hexCount: integer('hex_count').notNull().default(0),
    flags: jsonb('flags')
      .$type<WalkFlag[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
  },
  (t) => [
    unique('walk_sessions_user_client_walk_unique').on(t.userId, t.clientWalkId),
    index('walk_sessions_user_started_idx').on(t.userId, t.startedAt.desc()),
    index('walk_sessions_path_simplified_gist').using('gist', t.pathSimplified),
    index('walk_sessions_active_user_idx')
      .on(t.userId)
      .where(sql`status = 'active'`),
    index('walk_sessions_week_id_idx').on(t.weekId),
  ],
);

/**
 * Raw GPS samples, retained 30 days (Constitution IV). The table is `PARTITION BY RANGE (ts)` in
 * the database (monthly partitions, see drizzle/0000_init.sql and 0001_partitions.sql); Drizzle
 * cannot express partitioning, so this definition only types queries and inserts. The primary key
 * includes `ts` because Postgres requires the partition key in every unique constraint.
 */
export const locationSamples = pgTable(
  'location_samples',
  {
    walkId: uuid('walk_id')
      .notNull()
      .references(() => walkSessions.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    lat: doublePrecision('lat').notNull(),
    lon: doublePrecision('lon').notNull(),
    hAcc: real('h_acc').notNull(),
    speed: real('speed'),
    course: real('course'),
    alt: real('alt'),
    accepted: boolean('accepted').notNull().default(true),
    rejectReason: text('reject_reason'),
  },
  (t) => [
    primaryKey({ name: 'location_samples_pkey', columns: [t.walkId, t.seq, t.ts] }),
    index('location_samples_ts_idx').on(t.ts),
  ],
);

export const walkHexMeters = pgTable(
  'walk_hex_meters',
  {
    walkId: uuid('walk_id')
      .notNull()
      .references(() => walkSessions.id, { onDelete: 'cascade' }),
    h3R9: bigint('h3_r9', { mode: 'bigint' }).notNull(),
    meters: real('meters').notNull(),
  },
  (t) => [
    primaryKey({ name: 'walk_hex_meters_pkey', columns: [t.walkId, t.h3R9] }),
    index('walk_hex_meters_h3_r9_idx').on(t.h3R9),
  ],
);
