import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'vitest/config';

loadEnv({ path: '.env.test', quiet: true });

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/globalSetup.ts'],
    setupFiles: ['tests/setup.ts'],
    fileParallelism: false,
  },
});
