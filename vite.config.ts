/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // The rules are the part worth holding a line under; the screens are covered through
      // the whole-app tests rather than by chasing a number.
      include: ['src/domain/**', 'src/app/**'],
      // Set just under what the suite actually reaches, so a real regression trips them
      // while an ordinary refactor does not.
      thresholds: { statements: 95, branches: 90, functions: 95, lines: 95 },
    },
  },
});
