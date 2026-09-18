import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** The unit suite: the pure modules in src/lib, run in Node, no services.
 *  Everything that needs a database or a bucket is in tests/integration and
 *  runs with `npm run test:integration` against the local stack. */
export default defineConfig({
  resolve: { alias: { $lib: here('./src/lib') } },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**', 'node_modules/**'],
  },
});
