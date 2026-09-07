import { sql } from 'drizzle-orm';
import { bigserial, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { captures } from './captures.js';
import { users } from './users.js';
import { walkSessions } from './walks.js';

/** Audit table for cheap cheat detection; flagged walks are excluded from the reckoning. */
export const antiCheatFlags = pgTable(
  'anti_cheat_flags',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    walkId: uuid('walk_id').references(() => walkSessions.id, { onDelete: 'set null' }),
    captureId: uuid('capture_id').references(() => captures.id, { onDelete: 'set null' }),
    code: text('code').notNull(),
    details: jsonb('details')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolution: text('resolution'),
  },
  (t) => [
    index('anti_cheat_flags_user_id_idx').on(t.userId),
    index('anti_cheat_flags_open_idx')
      .on(t.createdAt)
      .where(sql`resolved_at is null`),
  ],
);
