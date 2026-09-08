import { defineConfig } from 'vitest/config';

/**
 * Integration tests run against a real PostgreSQL:
 * - CI: GitHub Actions provides a postgres service and exports DATABASE_URL.
 * - Local: test/setup.ts boots a throwaway embedded PostgreSQL (from the
 *   embedded-postgres devDependency) on 127.0.0.1:54330 when DATABASE_URL is unset.
 */
export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
    env: {
      // Integration tests exercise auth endpoints far more than the rate limit allows.
      RATE_LIMIT_MAX: '100000',
      AUTH_RATE_LIMIT_MAX: '100000',
    },
    // Files share one PostgreSQL; run sequentially to avoid cross-file interference.
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
