import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { exportStatusEnum } from './enums.js';
import { users } from './users.js';

/**
 * One row per data-export request (specs/002-auth-and-factions/data-model.md §1.1). The bundle
 * itself lives in object storage under `object_key`; rows are deleted by the purge job and
 * cascade with the user.
 */
export const accountExports = pgTable(
  'account_exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: exportStatusEnum('status').notNull().default('pending'),
    objectKey: text('object_key'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    error: text('error'),
  },
  (t) => [index('account_exports_user_requested_idx').on(t.userId, t.requestedAt.desc())],
);
