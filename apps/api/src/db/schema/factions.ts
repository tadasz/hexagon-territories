import { pgTable, smallint, text } from 'drizzle-orm/pg-core';

/**
 * The three factions (Owls, Foxes, Deer). Names, emoji and colours live only in the seed
 * migration `drizzle/0002_seed_factions.sql`, so renaming is a data change, not a code change.
 */
export const factions = pgTable('factions', {
  id: smallint('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  emoji: text('emoji').notNull(),
  colorLight: text('color_light').notNull(),
  colorDark: text('color_dark').notNull(),
  sort: smallint('sort').notNull(),
});
