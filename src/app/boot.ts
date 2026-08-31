import { apiKeys, attachStorage, auth, seedDatabase, sessions, teams } from '@/domain';

export interface BootResult {
  /** Whether demo data was installed, as opposed to a previous session being adopted. */
  seeded: boolean;
  /** Pending invites whose window had closed while nobody was looking. */
  expiredInvites: number;
  /** API keys that reached their expiry between sessions. */
  expiredApiKeys: number;
  /** Signed-in sessions that reached their expiry while the console was closed. */
  expiredSessions: number;
  /** Half-finished sign-ins nobody came back to answer. */
  expiredSignInChallenges: number;
}

/**
 * Boot sequence for the console: adopt whatever the last session left in storage, and fall
 * back to seeding demo data when there is nothing usable there — so a first-time visitor
 * lands on a populated console instead of an empty one.
 *
 * Restored tables then get a sweep for the rows that aged out between sessions — invites past
 * their window, API keys past their expiry, and signed-in sessions past theirs. Screens derive
 * all three statuses as they read them and never depended on this, but the stored rows are
 * what outlives the session, and leaving them claiming to be pending or active long after
 * they died would mislead anything that reads them without going through the domain.
 *
 * A half-finished sign-in is the one row the sweep deletes rather than stamps. An invite, an
 * API key, and a session all have something left to tell a reader once they are over; a
 * challenge nobody answered has nothing to say beyond its own existence, and the sign-in
 * attempt table already records what was tried.
 *
 * Sessions are the sweep's best case: a browser closed for a fortnight comes back to rows
 * that say plainly when each of them ended, rather than to a table that has to be reasoned
 * about against the clock every time anybody reads it.
 */
export function bootstrapDatabase(storage: Storage | null): BootResult {
  const restored = attachStorage(storage);
  if (restored) {
    return {
      seeded: false,
      expiredInvites: teams.expireStaleInvites(),
      expiredApiKeys: apiKeys.expireStaleApiKeys(),
      expiredSessions: sessions.expireStaleSessions(),
      expiredSignInChallenges: auth.expireStaleSignInChallenges(),
    };
  }
  seedDatabase();
  return {
    seeded: true,
    expiredInvites: 0,
    expiredApiKeys: 0,
    expiredSessions: 0,
    expiredSignInChallenges: 0,
  };
}
