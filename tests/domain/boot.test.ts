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

    expect(bootstrapDatabase(window.localStorage)).toEqual({
      seeded: true,
      expiredInvites: 0,
      expiredApiKeys: 0,
      expiredSessions: 0,
      expiredSignInChallenges: 0,
    });
    expect(getDatabase().users).toHaveLength(5);
    expect(getDatabase().teams.map((team) => team.slug)).toEqual(['platform', 'growth']);
  });

  it('adopts a previous session instead of overwriting it', () => {
    attachStorage(window.localStorage);
    const previous = buildSeedDatabase();
    previous.teams = [];
    replaceDatabase(previous);

    expect(bootstrapDatabase(window.localStorage)).toEqual({
      seeded: false,
      expiredInvites: 0,
      expiredApiKeys: 0,
      expiredSessions: 0,
      expiredSignInChallenges: 0,
    });
    expect(getDatabase().teams).toHaveLength(0);
  });

  it('seeds rather than failing when the stored data cannot be used', () => {
    window.localStorage.setItem(STORAGE_KEY, '{"version":0}');

    expect(bootstrapDatabase(window.localStorage)).toEqual({
      seeded: true,
      expiredInvites: 0,
      expiredApiKeys: 0,
      expiredSessions: 0,
      expiredSignInChallenges: 0,
    });
    expect(getDatabase().users).toHaveLength(5);
  });

  it('runs without any storage at all', () => {
    expect(bootstrapDatabase(null)).toEqual({
      seeded: true,
      expiredInvites: 0,
      expiredApiKeys: 0,
      expiredSessions: 0,
      expiredSignInChallenges: 0,
    });
    expect(getDatabase().users).toHaveLength(5);
  });

  it('retires invites that aged out between sessions', () => {
    attachStorage(window.localStorage);
    const previous = buildSeedDatabase();
    const invite = previous.invites[0];
    if (invite) invite.expiresAt = new Date(Date.now() - 1000).toISOString();
    replaceDatabase(previous);

    expect(bootstrapDatabase(window.localStorage)).toEqual({
      seeded: false,
      expiredInvites: 1,
      expiredApiKeys: 0,
      expiredSessions: 0,
      expiredSignInChallenges: 0,
    });
    expect(getDatabase().invites[0]?.status).toBe('EXPIRED');
  });

  it('leaves a live invite pending', () => {
    attachStorage(window.localStorage);
    replaceDatabase(buildSeedDatabase());

    expect(bootstrapDatabase(window.localStorage).expiredInvites).toBe(0);
    expect(getDatabase().invites[0]?.status).toBe('PENDING');
  });
});
