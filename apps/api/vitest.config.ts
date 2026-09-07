import { defineConfig } from 'vitest/config';

// Two projects: `unit` never touches the network or a database; `integration` needs Postgres and
// resolves it via test/helpers/db.ts (SKIP_DB_TESTS=1 -> skip, DATABASE_URL -> use it, else
// Testcontainers). Run one with `vitest run --project unit`.
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['test/unit/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['test/integration/**/*.test.ts'],
          globalSetup: ['test/helpers/global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
