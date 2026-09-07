import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Tests import `@nature/h3-fixtures`; alias it to the sibling package's source so
// `npx vitest run` works without building the fixtures package first (turbo builds it anyway).
const fixturesSrc = fileURLToPath(new URL('../h3-fixtures/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^@nature\/h3-fixtures$/, replacement: fixturesSrc }],
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
