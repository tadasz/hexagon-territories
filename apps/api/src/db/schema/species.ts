import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
} from 'drizzle-orm/pg-core';
import { kingdomEnum } from './enums.js';

export const species = pgTable(
  'species',
  {
    id: serial('id').primaryKey(),
    kingdom: kingdomEnum('kingdom').notNull(),
    scientificName: text('scientific_name').notNull().unique(),
    commonNameEn: text('common_name_en'),
    commonNameLt: text('common_name_lt'),
    family: text('family'),
    gbifKey: integer('gbif_key').unique(),
    birdnetLabel: text('birdnet_label').unique(),
    plantnetId: text('plantnet_id'),
    rarityTier: smallint('rarity_tier').notNull().default(1),
    imageUrl: text('image_url'),
    imageLicense: text('image_license'),
    imageAttribution: text('image_attribution'),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [index('species_kingdom_idx').on(t.kingdom)],
);

/** Per-region presence flag (lower-case ISO 3166-1 alpha-2); `lt` is the first seeded region. */
export const speciesRegion = pgTable(
  'species_region',
  {
    speciesId: integer('species_id')
      .notNull()
      .references(() => species.id, { onDelete: 'cascade' }),
    regionCode: text('region_code').notNull(),
  },
  (t) => [
    primaryKey({ name: 'species_region_pkey', columns: [t.speciesId, t.regionCode] }),
    index('species_region_region_species_idx').on(t.regionCode, t.speciesId),
  ],
);

export const speciesSeason = pgTable(
  'species_season',
  {
    speciesId: integer('species_id')
      .notNull()
      .references(() => species.id, { onDelete: 'cascade' }),
    week: smallint('week').notNull(),
    present: boolean('present').notNull(),
  },
  (t) => [
    primaryKey({ name: 'species_season_pkey', columns: [t.speciesId, t.week] }),
    check('species_season_week_check', sql`${t.week} between 1 and 53`),
  ],
);
