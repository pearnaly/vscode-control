import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Child processes, not worker threads: tests/bridge/processTree.test.ts uses process.chdir(), which
    // throws in a worker thread. Spelled out so a change of vitest's default pool cannot break it.
    pool: 'forks',
  },
});
