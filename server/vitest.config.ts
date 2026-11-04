import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    env: { DB_PATH: ':memory:', NODE_ENV: 'test', LOG_LEVEL: 'silent', AUTH_SECRET: 'test-secret-test-secret-1234' },
    // un DB singleton in memoria per file: i file girano in processi/worker separati
    fileParallelism: true,
  },
});
