import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** The integration suite drives the real server modules against the local
 *  stack: Postgres through the app's own connection role, and the bucket over
 *  S3. It needs DATABASE_URL and the S3_* variables; tests/integration/env.ts
 *  says which and fails loudly when one is missing. */
export default defineConfig({
  resolve: { alias: { $lib: here('./src/lib') } },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    fileParallelism: false,
  },
});
