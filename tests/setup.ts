import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { attachStorage, buildSeedDatabase, replaceDatabase } from '@/domain';

/**
 * Every test starts from the same freshly built demo dataset with persistence switched off,
 * so the suite touches no files, no network, and no browser storage — and no test can leak
 * state into the next one. The seed is built against the real clock rather than a frozen
 * instant, because its records carry relative windows (an invite expires seven days after it
 * is issued) that only stay meaningful next to a matching "now".
 */
beforeEach(() => {
  attachStorage(null);
  replaceDatabase(buildSeedDatabase());
  try {
    globalThis.localStorage?.clear();
  } catch {
    // jsdom always provides localStorage; a non-DOM environment simply has nothing to clear.
  }
});

afterEach(() => {
  cleanup();
});
