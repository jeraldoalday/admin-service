import { describe, expect, it } from 'vitest';
import { bootstrapDatabase } from '@/app/boot';
import {
  STORAGE_KEY,
  attachStorage,
  buildSeedDatabase,
  getDatabase,
  replaceDatabase,
} from '@/domain';

describe('bootstrapDatabase', () => {
  it('seeds demo data for a first-time visitor', () => {
    window.localStorage.clear();

    expect(bootstrapDatabase(window.localStorage)).toEqual({ seeded: true });
    expect(getDatabase().users).toHaveLength(5);
    expect(getDatabase().teams.map((team) => team.slug)).toEqual(['platform', 'growth']);
  });

  it('adopts a previous session instead of overwriting it', () => {
    attachStorage(window.localStorage);
    const previous = buildSeedDatabase();
    previous.teams = [];
    replaceDatabase(previous);

    expect(bootstrapDatabase(window.localStorage)).toEqual({ seeded: false });
    expect(getDatabase().teams).toHaveLength(0);
  });

  it('seeds rather than failing when the stored data cannot be used', () => {
    window.localStorage.setItem(STORAGE_KEY, '{"version":0}');

    expect(bootstrapDatabase(window.localStorage)).toEqual({ seeded: true });
    expect(getDatabase().users).toHaveLength(5);
  });

  it('runs without any storage at all', () => {
    expect(bootstrapDatabase(null)).toEqual({ seeded: true });
    expect(getDatabase().users).toHaveLength(5);
  });
});
