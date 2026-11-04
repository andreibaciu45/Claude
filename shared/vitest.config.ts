// Config vitest per i test di shared/** (puri, ambiente node). Esecuzione:
//   npx vitest run -c shared/vitest.config.ts
// Il vite.config.ts di root include solo src/**: il coordinatore può aggiungere 'shared/**/*.test.ts'.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: { environment: 'node', include: ['**/*.test.ts'] },
});
