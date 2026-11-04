import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    env: { DB_PATH: ':memory:', NODE_ENV: 'test', LOG_LEVEL: 'silent', AUTH_SECRET: 'test-secret-test-secret-1234' },
    // un DB singleton in memoria per file: i file girano in processi/worker separati
    fileParallelism: true,
    // TEST_FAKE_NOW=<ISO> sposta l'orologio per cercare dipendenze dalla data (vedi scripts/test/fake-now.setup.ts)
    setupFiles: process.env.TEST_FAKE_NOW ? ['../scripts/test/fake-now.setup.ts'] : [],
    // tetto per test bloccati (i test con processi figli sono lenti per natura: 2-5 s)
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
