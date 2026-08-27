/**
 * Entity types for the admin console.
 *
 * These mirror the shapes the service previously persisted with Prisma. Timestamps are
 * ISO-8601 strings rather than `Date` objects so that records survive a round trip through
 * `JSON.stringify`/`localStorage` without a revival step.
 */

export type UserRole = 'ADMIN' | 'MEMBER';
export const USER_ROLES: UserRole[] = ['ADMIN', 'MEMBER'];

export type TeamRole = 'OWNER' | 'ADMIN' | 'MEMBER';
export const TEAM_ROLES: TeamRole[] = ['OWNER', 'ADMIN', 'MEMBER'];

export type InviteStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
export const INVITE_STATUSES: InviteStatus[] = ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'];

export type TeamPermission =
  'MANAGE_TEAM' | 'MANAGE_MEMBERS' | 'MANAGE_INVITES' | 'MANAGE_PERMISSIONS' | 'MANAGE_API_KEYS';

export const TEAM_PERMISSIONS: TeamPermission[] = [
  'MANAGE_TEAM',
  'MANAGE_MEMBERS',
  'MANAGE_INVITES',
  'MANAGE_PERMISSIONS',
  'MANAGE_API_KEYS',
];

/**
 * Permissions every member of a role has by default, independent of any grants.
 * OWNER and ADMIN start out equally capable; team deletion stays a hardcoded OWNER-only
 * check and is deliberately not part of this permission set.
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<TeamRole, TeamPermission[]> = {
  OWNER: [...TEAM_PERMISSIONS],
  ADMIN: [...TEAM_PERMISSIONS],
  MEMBER: [],
};

export type ApiKeyStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';
export const API_KEY_STATUSES: ApiKeyStatus[] = ['ACTIVE', 'REVOKED', 'EXPIRED'];

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TeamRecord {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMembershipRecord {
  id: string;
  teamId: string;
  userId: string;
  role: TeamRole;
  createdAt: string;
}

export interface TeamInviteRecord {
  id: string;
  teamId: string;
  email: string;
  role: TeamRole;
  token: string;
  status: InviteStatus;
  invitedById: string;
  expiresAt: string;
  createdAt: string;
}

export interface TeamPermissionGrantRecord {
  id: string;
  teamId: string;
  userId: string;
  permission: TeamPermission;
  createdAt: string;
}

export interface ApiKeyRecord {
  id: string;
  teamId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  permissions: TeamPermission[];
  status: ApiKeyStatus;
  createdById: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * How a sign-in ended.
 *
 * FAILED covers a wrong password and an email nobody has an account for alike — the two are
 * the same event from the form's point of view, and recording them differently would turn
 * the attempt log into the account enumeration oracle the sign-in form itself refuses to be.
 *
 * BLOCKED is an attempt the credentials never got to decide: one refused by the lockout, or
 * one whose password was right but whose account has been deactivated. Keeping those out of
 * FAILED is what stops them counting towards a lock — a deactivated account should not come
 * back from deactivation locked as well, and a locked-out address should not be able to
 * extend its own lockout by continuing to knock.
 */
export type SignInOutcome = 'SUCCEEDED' | 'FAILED' | 'BLOCKED';
export const SIGN_IN_OUTCOMES: SignInOutcome[] = ['SUCCEEDED', 'FAILED', 'BLOCKED'];

/**
 * One attempt to sign in, successful or not.
 *
 * The email is recorded even when no account matches it, since a run of attempts against an
 * address nobody has is exactly the pattern worth being able to see. The row is the only
 * durable trace of an attempt: the lockout is derived from these rows rather than from a
 * counter on the account, so what locked an account out is always still legible after the
 * fact.
 */
export interface SignInAttemptRecord {
  id: string;
  /** Normalised to lower case, matching how accounts store theirs. */
  email: string;
  /** The account the email resolved to, or null when nobody holds it. */
  userId: string | null;
  outcome: SignInOutcome;
  /**
   * When an administrator cleared the lockout, if they did. Cleared attempts stay in the
   * table and stay readable; they simply stop counting towards a lock, which is what keeps
   * an unlock from erasing the history that explains it.
   */
  clearedAt: string | null;
  createdAt: string;
}

/**
 * A signed-in session. It stands in for the refresh token the API used to issue: the browser
 * holds an opaque id, and everything that decides whether the session is still good — expiry,
 * revocation, the state of the account behind it — lives here rather than inside a token
 * nobody can take back once it is out.
 */
export interface UserSessionRecord {
  id: string;
  userId: string;
  /** Where the session was started from, as far as the browser would say. */
  label: string;
  expiresAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  /** Who ended it — the session's own owner, another of their sessions, or an admin. */
  revokedById: string | null;
  createdAt: string;
}

export type SessionStatus = 'ACTIVE' | 'REVOKED' | 'EXPIRED';
export const SESSION_STATUSES: SessionStatus[] = ['ACTIVE', 'REVOKED', 'EXPIRED'];

export interface AuditLogRecord {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  /**
   * The team an entry belongs to, or null for a platform-level one. Stamped at write time
   * rather than inferred on read: a membership id can be taken apart to find its team, but an
   * invite or an API key cannot once the row it named has been deleted, and an audit trail
   * that loses track of which team an action belonged to is not much of a trail.
   */
  teamId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/** Public projection of a user — never carries the password hash. */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
}

/** Admin-facing projection, which additionally exposes account status. */
export interface AdminUserView extends PublicUser {
  isActive: boolean;
  updatedAt: string;
}

export interface TeamView {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamWithRole extends TeamView {
  role: TeamRole;
}

export interface TeamMemberView {
  userId: string;
  email: string;
  displayName: string;
  role: TeamRole;
  createdAt: string;
}

export interface TeamInviteView {
  id: string;
  teamId: string;
  email: string;
  role: TeamRole;
  status: InviteStatus;
  token: string;
  expiresAt: string;
  createdAt: string;
}

export interface EffectivePermissions {
  role: TeamRole;
  rolePermissions: TeamPermission[];
  grantedPermissions: TeamPermission[];
  effectivePermissions: TeamPermission[];
}

/** API key projection — the plaintext secret is never part of it. */
export interface ApiKeyView {
  id: string;
  teamId: string;
  name: string;
  keyPrefix: string;
  permissions: TeamPermission[];
  status: ApiKeyStatus;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A session as its owner sees it. The id is included because it is not a secret from the
 * account that holds it — it is what the screen revokes by — and `isCurrent` is what stops
 * somebody signing themselves out while trying to clear an old device.
 */
export interface UserSessionView {
  id: string;
  userId: string;
  label: string;
  status: SessionStatus;
  isCurrent: boolean;
  expiresAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface SignInAttemptView {
  id: string;
  email: string;
  userId: string | null;
  outcome: SignInOutcome;
  clearedAt: string | null;
  createdAt: string;
}

/**
 * The lockout state of one account, derived rather than stored. `retriesRemaining` is what a
 * screen shows somebody who has mistyped a password twice; `lockedUntil` is what it shows
 * once there are none left.
 */
export interface AccountLockView {
  email: string;
  isLocked: boolean;
  failedAttempts: number;
  retriesRemaining: number;
  lockedUntil: string | null;
}

export interface AuditLogView {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  teamId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
