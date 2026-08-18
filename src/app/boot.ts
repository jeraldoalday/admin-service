import { attachStorage, seedDatabase, teams } from '@/domain';

export interface BootResult {
  /** Whether demo data was installed, as opposed to a previous session being adopted. */
  seeded: boolean;
  /** Pending invites whose window had closed while nobody was looking. */
  expiredInvites: number;
}

/**
 * Boot sequence for the console: adopt whatever the last session left in storage, and fall
 * back to seeding demo data when there is nothing usable there — so a first-time visitor
 * lands on a populated console instead of an empty one.
 *
 * Restored tables then get a sweep for invites that aged out between sessions. Screens derive
 * an invite's status as they read it and never depended on this, but the stored rows are what
 * outlives the session, and leaving them claiming to be pending long after they died would
 * mislead anything that reads them without going through the domain.
 */
export function bootstrapDatabase(storage: Storage | null): BootResult {
  const restored = attachStorage(storage);
  if (restored) {
    return { seeded: false, expiredInvites: teams.expireStaleInvites() };
  }
  seedDatabase();
  return { seeded: true, expiredInvites: 0 };
}
