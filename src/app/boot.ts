import { attachStorage, seedDatabase } from '@/domain';

/**
 * Boot sequence for the console: adopt whatever the last session left in storage, and fall
 * back to seeding demo data when there is nothing usable there — so a first-time visitor
 * lands on a populated console instead of an empty one. Returns whether it seeded.
 */
export function bootstrapDatabase(storage: Storage | null): { seeded: boolean } {
  const restored = attachStorage(storage);
  if (restored) {
    return { seeded: false };
  }
  seedDatabase();
  return { seeded: true };
}
