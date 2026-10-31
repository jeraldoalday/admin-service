import { describe, expect, it } from 'vitest';
import {
  STORAGE_KEY,
  attachStorage,
  buildSeedDatabase,
  emptyDatabase,
  getDatabase,
  replaceDatabase,
  teams,
} from '@/domain';
import { adminActor } from '../helpers';

/**
 * The store mirrors itself into `localStorage` so a reload does not discard the session's
 * work. jsdom provides a real implementation, so these exercise the actual code path rather
 * than a stand-in.
 */
describe('persistence', () => {
  it('writes through to storage on every mutation', () => {
    attachStorage(window.localStorage);
    replaceDatabase(buildSeedDatabase());

    teams.createTeam(adminActor(), { name: 'Support' });

    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).toContain('Support');
  });

  it('restores what a previous session left behind', () => {
    attachStorage(window.localStorage);
    replaceDatabase(buildSeedDatabase());
    teams.createTeam(adminActor(), { name: 'Support' });

    // Simulate a page reload: detach first, so clearing the in-memory tables is not itself
    // written through to storage, then forget everything and re-attach the way boot does.
    attachStorage(null);
    replaceDatabase(emptyDatabase());
    expect(getDatabase().teams).toHaveLength(0);

    expect(attachStorage(window.localStorage)).toBe(true);
    expect(getDatabase().teams.map((team) => team.name)).toContain('Support');
  });

  it('reports nothing to restore when storage is empty', () => {
    window.localStorage.clear();
    expect(attachStorage(window.localStorage)).toBe(false);
  });

  it('discards corrupt or foreign data rather than loading it', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not json at all');
    expect(attachStorage(window.localStorage)).toBe(false);

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 999, users: [] }));
    expect(attachStorage(window.localStorage)).toBe(false);
  });

  it('discards valid JSON that is not a database object', () => {
    // `JSON.parse` succeeds on these, so the rejection has to come from the shape check
    // rather than the parse failing — the case a plain string, number, or null in storage
    // would hit if something other than this app ever wrote to the key.
    window.localStorage.setItem(STORAGE_KEY, '42');
    expect(attachStorage(window.localStorage)).toBe(false);

    window.localStorage.setItem(STORAGE_KEY, 'null');
    expect(attachStorage(window.localStorage)).toBe(false);
  });

  it('keeps running when storage refuses to accept writes', () => {
    const failing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    } as unknown as Storage;

    attachStorage(failing);
    replaceDatabase(buildSeedDatabase());

    expect(() => teams.createTeam(adminActor(), { name: 'Support' })).not.toThrow();
    expect(getDatabase().teams).toHaveLength(3);
  });
});
