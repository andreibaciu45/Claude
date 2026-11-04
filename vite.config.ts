import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // 5 s (predefinito) sono pochi quando la suite gira in parallelo con altre cose (CI, altri agenti): i limiti di
    // prestazione veri sono asseriti nei test, questo è solo il tetto oltre il quale un test si considera bloccato.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // TEST_FAKE_NOW=<ISO> fissa Date per cercare dipendenze dall'orologio (vedi scripts/test/fake-now.setup.ts)
    setupFiles: process.env.TEST_FAKE_NOW ? ['scripts/test/fake-now.setup.ts'] : [],
    // Copertura (richiede @vitest/coverage-v8, NON installato: `npm i -D @vitest/coverage-v8@^5` poi `npm run test:coverage`)
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'shared/**/*.ts'],
      exclude: ['**/*.test.{ts,tsx}', '**/__tests__/**', '**/testkit.ts', '**/testutils.ts', '**/testing/**', 'src/engine/bench/**', 'shared/**/__fixtures__/**'],
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
    },
  },
});
