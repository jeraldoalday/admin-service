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
    // The default 5s is tight for a whole-app test driving real screens under jsdom — on a
    // loaded machine the suite's slowest tests can brush up against it even though nothing is
    // actually hung, which trips a false failure rather than catching a real regression.
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // The rules are the part worth holding a line under; the screens are covered through
      // the whole-app tests rather than by chasing a number.
      include: ['src/domain/**', 'src/app/**'],
      // Set just under what the suite actually reaches, so a real regression trips them
      // while an ordinary refactor does not.
      thresholds: { statements: 96, branches: 91, functions: 97, lines: 96 },
    },
  },
});
