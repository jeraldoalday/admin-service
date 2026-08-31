import { emptyDatabase, replaceDatabase, type Database } from './database';
import { createId, createToken } from './ids';
import { hashPassword } from './password';
import { SESSION_TTL_MS } from './sessions';
import { INVITE_TTL_MS } from './teams';
import { recoveryCodeHash } from './twoFactor';
import type { SignInAttemptRecord, UserRecord, UserSessionRecord } from './types';

/** Every seeded account shares this password so the demo is explorable without a handbook. */
export const DEMO_PASSWORD = 'password123';

export const DEMO_ADMIN_EMAIL = 'admin@example.com';

/**
 * The seeded account that already has an authenticator, and the key behind it.
 *
 * A demo where nobody has two-step verification turned on shows the feature only to
 * somebody willing to set it up on their own phone first, which is a high price for
 * looking at a screen. Publishing the key makes the second step explorable in the same
 * spirit as publishing the password: this dataset is a fixture, not a secret, and the
 * console says so on the sign-in card.
 */
export const DEMO_TWO_FACTOR_EMAIL = 'raj@example.com';
export const DEMO_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

/**
 * The recovery codes that account was issued. One of them is already spent, since a set
 * where every code is untouched never shows what a used one looks like.
 */
export const DEMO_RECOVERY_CODES = Object.freeze([
  'H4KDM-2QW7T',
  'R9XPZ-J3NC6',
  'V2LTF-8MYB4',
  'K7GRD-5HQXN',
  'T3WJC-9PFML',
  'B6NZQ-4RKTV',
  'D8YMH-7XLGP',
  'F5QCK-2VJRW',
  'N4TBX-6ZHDM',
  'P9RVL-3KWQY',
] as const);

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * Builds the demo dataset: an admin, a handful of members, two teams with overlapping
 * rosters, a granted permission that outruns its holder's role, a pending invite, an API
 * key, a few signed-in devices, and enough sign-in history for the lockout to be visible
 * without having to be provoked. It is written straight into the tables rather than through
 * the domain functions, so seeding cannot trip over the very guards it exists to demonstrate.
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

  // Raj arrives with two-step verification already on, so the account screen, the users
  // column, and the second step at sign-in are all visible the moment the console opens.
  db.twoFactor.push({
    id: createId(),
    userId: raj.id,
    secret: DEMO_TOTP_SECRET,
    confirmedAt: at(10),
    // Left unset on purpose: the replay floor is a record of codes this console has
    // accepted, and it has not accepted any yet. Seeding a step would refuse the first code
    // somebody tries if their clock happened to sit behind the fixture's.
    lastUsedStep: null,
    createdAt: at(10),
    updatedAt: at(10),
  });

  db.recoveryCodes.push(
    ...DEMO_RECOVERY_CODES.map((code, index) => ({
      id: createId(),
      userId: raj.id,
      codeHash: recoveryCodeHash(raj.id, code),
      usedAt: index === 0 ? at(4) : null,
      createdAt: at(10),
    })),
  );

  const minutesAgo = (minutes: number): string => new Date(now - minutes * MINUTE_MS).toISOString();

  const session = (
    userId: string,
    label: string,
    startedDaysAgo: number,
    lastSeenMinutesAgo: number,
    revokedDaysAgo: number | null = null,
  ): UserSessionRecord => ({
    id: createToken(18),
    userId,
    label,
    expiresAt: new Date(now - startedDaysAgo * DAY_MS + SESSION_TTL_MS).toISOString(),
    lastSeenAt: minutesAgo(lastSeenMinutesAgo),
    revokedAt: revokedDaysAgo === null ? null : at(revokedDaysAgo),
    revokedById: revokedDaysAgo === null ? null : userId,
    createdAt: at(startedDaysAgo),
  });

  // Two live devices and one Avery ended by hand — the shape somebody is meant to recognise
  // on the security panel, where the interesting row is the one you do not remember opening.
  db.sessions.push(
    session(admin.id, 'Chrome on macOS', 2, 4),
    session(admin.id, 'Safari on iOS', 5, 900),
    session(admin.id, 'Firefox on Windows', 6, 2200, 5),
    session(dana.id, 'Chrome on macOS', 1, 30),
  );

  const attempt = (
    email: string,
    userId: string | null,
    outcome: SignInAttemptRecord['outcome'],
    minutes: number,
  ): SignInAttemptRecord => ({
    id: createId(),
    email,
    userId,
    outcome,
    clearedAt: null,
    createdAt: minutesAgo(minutes),
  });

  /**
   * Enough history for the sign-in panel to say something, and deliberately not enough to
   * lock any seeded account: every one of them shares the demo password, so an account that
   * arrived locked would be an account nobody could explore for the first quarter of an hour.
   * Raj carries three failures — under the threshold, which is exactly the state the
   * "attempts remaining" line exists to describe.
   *
   * The live lockout sits on an address no account holds, which is both harmless and the
   * pattern the attempt log is really kept for: a run of guesses against an address that was
   * never going to work says something about whoever is making them.
   */
  db.signInAttempts.push(
    attempt(admin.email, admin.id, 'SUCCEEDED', 2880),
    attempt(admin.email, admin.id, 'FAILED', 2875),
    attempt(admin.email, admin.id, 'SUCCEEDED', 2874),
    attempt(dana.email, dana.id, 'SUCCEEDED', 1440),
    attempt(sam.email, sam.id, 'BLOCKED', 4300),
    attempt(raj.email, raj.id, 'FAILED', 9),
    attempt(raj.email, raj.id, 'FAILED', 7),
    attempt(raj.email, raj.id, 'FAILED', 6),
    ...[13, 12, 11, 10, 9].map((minutes) =>
      attempt('postmaster@example.com', null, 'FAILED', minutes),
    ),
    attempt('postmaster@example.com', null, 'BLOCKED', 8),
  );

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
