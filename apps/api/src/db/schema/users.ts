import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { userRoleEnum } from './enums.js';
import { factions } from './factions.js';
import { bytea } from './postgis.js';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    appleSub: text('apple_sub').notNull().unique(),
    email: text('email'),
    displayName: text('display_name').notNull(),
    factionId: smallint('faction_id').references(() => factions.id),
    factionChangedAt: timestamp('faction_changed_at', { withTimezone: true }),
    xp: integer('xp').notNull().default(0),
    level: smallint('level').notNull().default(1),
    role: userRoleEnum('role').notNull().default('player'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('users_faction_id_idx').on(t.factionId),
    index('users_deleted_at_idx')
      .on(t.deletedAt)
      .where(sql`deleted_at is not null`),
  ],
);

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    apnsToken: text('apns_token').unique(),
    appVersion: text('app_version'),
    osVersion: text('os_version'),
    model: text('model'),
    attested: boolean('attested').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('devices_user_id_idx').on(t.userId)],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    deviceId: uuid('device_id').references(() => devices.id, { onDelete: 'set null' }),
  },
  (t) => [index('refresh_tokens_user_id_idx').on(t.userId)],
);
