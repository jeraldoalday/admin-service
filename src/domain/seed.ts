import { emptyDatabase, replaceDatabase, type Database } from './database';
import { createId, createToken } from './ids';
import { hashPassword } from './password';
import { INVITE_TTL_MS } from './teams';
import type { UserRecord } from './types';

/** Every seeded account shares this password so the demo is explorable without a handbook. */
export const DEMO_PASSWORD = 'password123';

export const DEMO_ADMIN_EMAIL = 'admin@example.com';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Builds the demo dataset: an admin, a handful of members, two teams with overlapping
 * rosters, a granted permission that outruns its holder's role, a pending invite, and an
 * API key. It is written straight into the tables rather than through the domain functions,
 * so seeding cannot trip over the very guards it exists to demonstrate.
 */
export function buildSeedDatabase(now = Date.now()): Database {
  const db = emptyDatabase();
  const passwordHash = hashPassword(DEMO_PASSWORD);
  const at = (daysAgo: number): string => new Date(now - daysAgo * DAY_MS).toISOString();

  const makeUser = (
    email: string,
    displayName: string,
    role: 'ADMIN' | 'MEMBER',
    daysAgo: number,
    isActive = true,
  ): UserRecord => ({
    id: createId(),
    email,
    passwordHash,
    displayName,
    role,
    isActive,
    createdAt: at(daysAgo),
    updatedAt: at(daysAgo),
  });

  const admin = makeUser(DEMO_ADMIN_EMAIL, 'Avery Admin', 'ADMIN', 30);
  const dana = makeUser('dana@example.com', 'Dana Diaz', 'MEMBER', 24);
  const raj = makeUser('raj@example.com', 'Raj Patel', 'MEMBER', 18);
  const mira = makeUser('mira@example.com', 'Mira Okafor', 'MEMBER', 12);
  const sam = makeUser('sam@example.com', 'Sam Lee', 'MEMBER', 6, false);
  db.users.push(admin, dana, raj, mira, sam);

  const platform = {
    id: createId(),
    name: 'Platform',
    slug: 'platform',
    createdAt: at(28),
    updatedAt: at(28),
  };
  const growth = {
    id: createId(),
    name: 'Growth',
    slug: 'growth',
    createdAt: at(15),
    updatedAt: at(15),
  };
  db.teams.push(platform, growth);

  db.memberships.push(
    { id: createId(), teamId: platform.id, userId: admin.id, role: 'OWNER', createdAt: at(28) },
    { id: createId(), teamId: platform.id, userId: dana.id, role: 'ADMIN', createdAt: at(23) },
    { id: createId(), teamId: platform.id, userId: raj.id, role: 'MEMBER', createdAt: at(17) },
    { id: createId(), teamId: growth.id, userId: dana.id, role: 'OWNER', createdAt: at(15) },
    { id: createId(), teamId: growth.id, userId: mira.id, role: 'MEMBER', createdAt: at(11) },
  );

  // Raj stays a plain MEMBER but can run the invite flow — the case fine-grained grants exist
  // for, and the one worth having visible the moment the console opens.
  db.permissionGrants.push({
    id: createId(),
    teamId: platform.id,
    userId: raj.id,
    permission: 'MANAGE_INVITES',
    createdAt: at(9),
  });

  db.invites.push({
    id: createId(),
    teamId: platform.id,
    email: 'noor@example.com',
    role: 'MEMBER',
    token: createToken(),
    status: 'PENDING',
    invitedById: admin.id,
    expiresAt: new Date(now - 2 * DAY_MS + INVITE_TTL_MS).toISOString(),
    createdAt: at(2),
  });

  const secret = `sk_${createToken()}`;
  db.apiKeys.push({
    id: createId(),
    teamId: platform.id,
    name: 'ci-pipeline',
    keyPrefix: secret.slice(0, 11),
    // Seeded from a secret that is thrown away here on purpose: a key you cannot present is
    // an honest demonstration that the plaintext is only ever shown once.
    keyHash: `seeded-${createToken(8)}`,
    permissions: ['MANAGE_MEMBERS'],
    status: 'ACTIVE',
    createdById: admin.id,
    expiresAt: null,
    lastUsedAt: at(1),
    revokedAt: null,
    createdAt: at(7),
    updatedAt: at(7),
  });

  db.auditLogs.push(
    {
      id: createId(),
      actorId: admin.id,
      action: 'team.created',
      targetType: 'team',
      targetId: platform.id,
      teamId: platform.id,
      metadata: { name: platform.name, slug: platform.slug },
      createdAt: at(28),
    },
    {
      id: createId(),
      actorId: admin.id,
      action: 'team.member.permissions_updated',
      targetType: 'team_membership',
      targetId: `${platform.id}:${raj.id}`,
      teamId: platform.id,
      metadata: { permissions: ['MANAGE_INVITES'] },
      createdAt: at(9),
    },
    {
      id: createId(),
      actorId: admin.id,
      action: 'api_key.created',
      targetType: 'api_key',
      targetId: db.apiKeys[0]?.id ?? null,
      teamId: platform.id,
      metadata: { name: 'ci-pipeline', permissions: ['MANAGE_MEMBERS'] },
      createdAt: at(7),
    },
    {
      id: createId(),
      actorId: admin.id,
      action: 'user.updated',
      targetType: 'user',
      targetId: sam.id,
      teamId: null,
      metadata: { isActive: false },
      createdAt: at(5),
    },
  );

  return db;
}

/** Discards whatever is in the tables and installs a fresh demo dataset. */
export function seedDatabase(now?: number): Database {
  const db = buildSeedDatabase(now);
  replaceDatabase(db);
  return db;
}
