import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // .tsx component tests need a DOM; plain .ts unit tests run in node.
    environmentMatchGlobs: [['**/*.test.tsx', 'jsdom']],
    setupFiles: ['./src/test-setup.ts'],
  },
});
