import { defineConfig } from 'drizzle-kit';

// `location_samples` is partitioned by hand in drizzle/0000_init.sql (Drizzle Kit cannot express
// PARTITION BY); it is filtered out of push/introspect diffs so later runs do not try to "fix" it.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  tablesFilter: ['!location_samples*'],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://nature:nature@localhost:5432/nature',
  },
  strict: true,
  verbose: true,
});
