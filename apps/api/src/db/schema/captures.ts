import { sql } from 'drizzle-orm';
import {
  bigint,
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
import { candidateSourceEnum, captureStatusEnum, kingdomEnum } from './enums.js';
import { factions } from './factions.js';
import { species } from './species.js';
import { users } from './users.js';
import { walkSessions } from './walks.js';

export const captures = pgTable(
  'captures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    clientCaptureId: uuid('client_capture_id').notNull(),
    walkId: uuid('walk_id').references(() => walkSessions.id, { onDelete: 'set null' }),
    kind: kingdomEnum('kind').notNull(),
    factionId: smallint('faction_id').references(() => factions.id),
    h3R9: bigint('h3_r9', { mode: 'bigint' }).notNull(),
    weekId: text('week_id').notNull(),
    lat: doublePrecision('lat').notNull(),
    lon: doublePrecision('lon').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    mediaKey: text('media_key'),
    mediaType: text('media_type'),
    mediaBytes: integer('media_bytes'),
    deviceModelVersion: text('device_model_version'),
    deviceSpeciesId: integer('device_species_id').references(() => species.id),
    deviceConfidence: real('device_confidence'),
    cloudProvider: text('cloud_provider'),
    cloudModelVersion: text('cloud_model_version'),
    cloudSpeciesId: integer('cloud_species_id').references(() => species.id),
    cloudConfidence: real('cloud_confidence'),
    cloudRaw: jsonb('cloud_raw').$type<Record<string, unknown>>(),
    finalSpeciesId: integer('final_species_id').references(() => species.id),
    status: captureStatusEnum('status').notNull().default('created'),
    bonusM: real('bonus_m').notNull().default(0),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('captures_user_client_capture_unique').on(t.userId, t.clientCaptureId),
    index('captures_user_created_idx').on(t.userId, t.createdAt.desc()),
    index('captures_h3_r9_idx').on(t.h3R9),
    // Verification queue: only the rows a worker will pick up.
    index('captures_verification_queue_idx')
      .on(t.status, t.createdAt)
      .where(sql`status in ('uploaded', 'verifying')`),
  ],
);

export const captureCandidates = pgTable(
  'capture_candidates',
  {
    captureId: uuid('capture_id')
      .notNull()
      .references(() => captures.id, { onDelete: 'cascade' }),
    source: candidateSourceEnum('source').notNull(),
    rank: smallint('rank').notNull(),
    speciesId: integer('species_id').references(() => species.id),
    rawLabel: text('raw_label').notNull(),
    confidence: real('confidence').notNull(),
  },
  (t) => [
    primaryKey({ name: 'capture_candidates_pkey', columns: [t.captureId, t.source, t.rank] }),
  ],
);

export const userSpecies = pgTable(
  'user_species',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    speciesId: integer('species_id')
      .notNull()
      .references(() => species.id),
    firstCaptureId: uuid('first_capture_id').references(() => captures.id, {
      onDelete: 'set null',
    }),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    captureCount: integer('capture_count').notNull().default(1),
  },
  (t) => [primaryKey({ name: 'user_species_pkey', columns: [t.userId, t.speciesId] })],
);
