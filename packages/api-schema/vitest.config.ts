import { defineConfig } from 'vitest/config';

// The staleness test regenerates the document by spawning the API's `openapi:print` script
// (tsx + Fastify boot), which takes a few seconds; no database or network is involved.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
  },
});
