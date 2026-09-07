import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The walk suites import `@nature/walk-sim` (the replay oracle) and `@nature/h3-fixtures`; alias
// both to the sibling packages' sources so the tests run without building them first (turbo
// builds them anyway; `typecheck` resolves the built declarations).
const walkSimSrc = fileURLToPath(new URL('../../packages/walk-sim/src/index.ts', import.meta.url));
const fixturesSrc = fileURLToPath(
  new URL('../../packages/h3-fixtures/src/index.ts', import.meta.url),
);

// Two projects: `unit` never touches the network or a database; `integration` needs Postgres and
// resolves it via test/helpers/db.ts (SKIP_DB_TESTS=1 -> skip, DATABASE_URL -> use it, else
// Testcontainers). Run one with `vitest run --project unit`.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@nature\/walk-sim$/, replacement: walkSimSrc },
      { find: /^@nature\/h3-fixtures$/, replacement: fixturesSrc },
    ],
  },
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
