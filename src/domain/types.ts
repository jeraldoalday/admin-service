/**
 * Entity types for the admin console.
 *
 * These mirror the shapes the service previously persisted with Prisma. Timestamps are
 * ISO-8601 strings rather than `Date` objects so that records survive a round trip through
 * `JSON.stringify`/`localStorage` without a revival step.
 */

/**
 * Each of these lists is the single description of its own set of values: the union type is
 * derived from the list rather than written beside it, and the zod enum in `validation.ts`
 * is built from the same list again. Spelling a set out twice is how a sixth permission ends
 * up accepted by the type checker and rejected by the schema — or, worse, the other way
 * round — and the duplication is invisible until exactly that happens.
 *
 * They are frozen as well as constant. `as const` is a promise to the type checker and
 * nothing more; these lists are read directly by the guards and rendered directly by the
 * screens, so a stray push into one would add a role or a permission to a running console.
 */
export const USER_ROLES = Object.freeze(['ADMIN', 'MEMBER'] as const);
export type UserRole = (typeof USER_ROLES)[number];

export const TEAM_ROLES = Object.freeze(['OWNER', 'ADMIN', 'MEMBER'] as const);
export type TeamRole = (typeof TEAM_ROLES)[number];

export const INVITE_STATUSES = Object.freeze([
  'PENDING',
  'ACCEPTED',
  'REVOKED',
  'EXPIRED',
] as const);
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export const TEAM_PERMISSIONS = Object.freeze([
  'MANAGE_TEAM',
  'MANAGE_MEMBERS',
  'MANAGE_INVITES',
  'MANAGE_PERMISSIONS',
  'MANAGE_API_KEYS',
] as const);
export type TeamPermission = (typeof TEAM_PERMISSIONS)[number];

/**
 * Permissions every member of a role has by default, independent of any grants.
 * OWNER and ADMIN start out equally capable; team deletion stays a hardcoded OWNER-only
 * check and is deliberately not part of this permission set.
 *
 * Frozen because every permission check in the console reads these arrays directly: they are
 * the definition of what a role means, and nothing should be able to edit that definition at
 * runtime — least of all by accident, through a list it was handed by a read.
 */
export const ROLE_DEFAULT_PERMISSIONS: Readonly<Record<TeamRole, readonly TeamPermission[]>> =
  Object.freeze({
    OWNER: Object.freeze([...TEAM_PERMISSIONS]),
    ADMIN: Object.freeze([...TEAM_PERMISSIONS]),
    MEMBER: Object.freeze([]),
  });

export const API_KEY_STATUSES = Object.freeze(['ACTIVE', 'REVOKED', 'EXPIRED'] as const);
export type ApiKeyStatus = (typeof API_KEY_STATUSES)[number];

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
export const SIGN_IN_OUTCOMES = Object.freeze(['SUCCEEDED', 'FAILED', 'BLOCKED'] as const);
export type SignInOutcome = (typeof SIGN_IN_OUTCOMES)[number];

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

export const SESSION_STATUSES = Object.freeze(['ACTIVE', 'REVOKED', 'EXPIRED'] as const);
export type SessionStatus = (typeof SESSION_STATUSES)[number];

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

/**
 * Admin-facing projection, which additionally exposes account status.
 *
 * The lock is derived from the sign-in attempt table as the row is read, in the same spirit
 * as an invite's or an API key's expiry: nothing rewrites the account when it locks, and
 * nothing has to rewrite it again when the lock lapses on its own.
 */
export interface AdminUserView extends PublicUser {
  isActive: boolean;
  isLocked: boolean;
  lockedUntil: string | null;
  /**
   * Whether a *confirmed* authenticator stands behind this account. A half-finished
   * enrolment reads as false here, because the column is answering "is this account harder
   * to take than its password?" and a secret nobody ever proved a code against is not.
   */
  hasTwoFactor: boolean;
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

/**
 * The four things an administrator can do to a batch of accounts at once. Each one is a
 * thing they could already do to a single account from its row; nothing is bulk-only, which
 * is what keeps the batch path from becoming a second, laxer set of rules.
 */
export const BULK_USER_ACTIONS = Object.freeze([
  'activate',
  'deactivate',
  'unlock',
  'delete',
] as const);
export type BulkUserAction = (typeof BULK_USER_ACTIONS)[number];

/**
 * What became of one account in a batch.
 *
 * UNCHANGED is deliberately not FAILED. Selecting forty accounts and deactivating them will
 * usually catch a few that were deactivated already, and reporting those as errors trains
 * the reader to ignore the error list — which is the one part of the report that matters.
 * It is not CHANGED either, since nothing was written and nothing reached the audit log.
 */
export const BULK_USER_OUTCOME_STATUSES = Object.freeze([
  'CHANGED',
  'UNCHANGED',
  'FAILED',
] as const);
export type BulkUserOutcomeStatus = (typeof BULK_USER_OUTCOME_STATUSES)[number];

/**
 * One line of a batch report. The name and email are captured before the action runs, so a
 * deleted account is still nameable in the report that says it was deleted.
 */
export interface BulkUserOutcome {
  userId: string;
  email: string;
  displayName: string;
  status: BulkUserOutcomeStatus;
  /** Why it was left alone or refused; null when it simply worked. */
  message: string | null;
}

export interface BulkUserActionResult {
  action: BulkUserAction;
  /** How many distinct accounts were asked for, which is not always how many were found. */
  requested: number;
  changed: BulkUserOutcome[];
  unchanged: BulkUserOutcome[];
  failed: BulkUserOutcome[];
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

// -- two-factor authentication ---------------------------------------------

/**
 * Where an account is in the enrolment.
 *
 * PENDING is a real state rather than an implementation detail: a secret is generated the
 * moment somebody asks to set an authenticator up, and it has to be stored — the codes are
 * derived from it, so there is nothing to check the first code against otherwise. What it
 * must not do in the meantime is start being required at sign-in. Somebody who scans a QR
 * code, puts their phone down, and closes the tab has not enrolled, and locking them out on
 * the strength of a secret they never confirmed is the way this feature does real damage.
 */
export const TWO_FACTOR_STATUSES = Object.freeze(['DISABLED', 'PENDING', 'ENABLED'] as const);
export type TwoFactorStatus = (typeof TWO_FACTOR_STATUSES)[number];

/**
 * One account's authenticator.
 *
 * `lastUsedStep` is the replay floor. A code is good for the whole thirty-second window it
 * names, so one that has been used is one somebody reading over a shoulder could use again
 * before it lapses; remembering the newest step accepted and refusing anything at or below
 * it closes that window to a single use. It is stored rather than derived because there is
 * nothing to derive it from — a code leaves no other trace.
 */
export interface TwoFactorRecord {
  id: string;
  userId: string;
  /** The shared secret, base32 as every authenticator expects it. */
  secret: string;
  /** When the first correct code proved the phone and the console agree. Null while pending. */
  confirmedAt: string | null;
  lastUsedStep: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One single-use code for the day the phone is lost.
 *
 * Stored as a SHA-256 digest, exactly as an API key secret is: the console can check a code
 * it is given without being able to hand the list back, which is what makes "write these
 * down now" an honest instruction rather than a formality. A used code keeps its row with a
 * timestamp rather than being deleted, so somebody can see that one was spent and when.
 */
export interface RecoveryCodeRecord {
  id: string;
  userId: string;
  codeHash: string;
  usedAt: string | null;
  createdAt: string;
}

/**
 * A sign-in that has passed the password and still owes a second factor.
 *
 * It exists as a row because the alternative is the browser holding "I got the password
 * right, honestly" and the console believing it. The challenge names the account, nothing
 * about it is guessable, it expires in minutes rather than days, and it is consumed on use —
 * so the thing standing between a correct password and a session is a record the domain
 * controls rather than a claim the client makes.
 */
export interface SignInChallengeRecord {
  id: string;
  userId: string;
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}

/** What the account screen shows about its own authenticator. The secret is never part of it. */
export interface TwoFactorView {
  status: TwoFactorStatus;
  confirmedAt: string | null;
  remainingRecoveryCodes: number;
  totalRecoveryCodes: number;
}

/**
 * What somebody needs in order to add the account to their authenticator: the secret to
 * scan, the same secret grouped for typing when a camera is not an option, and the URI the
 * QR code encodes. Handed out only to the account holder, and only while enrolling.
 */
export interface TwoFactorEnrolmentView {
  secret: string;
  /** The same secret in groups of four, for somebody typing it in by hand. */
  formattedSecret: string;
  otpauthUri: string;
}

/**
 * The result of confirming an enrolment: the new state, and the recovery codes, in plaintext,
 * for the only time they will ever be readable.
 */
export interface TwoFactorActivationView {
  twoFactor: TwoFactorView;
  recoveryCodes: string[];
}

/**
 * How a sign-in ended, for a caller that has to know whether to open a session or ask for
 * one more thing.
 *
 * It is a discriminated union rather than a user-or-null, because "here is your account" and
 * "prove it again" are different enough that a caller should not be able to confuse them by
 * forgetting a null check.
 */
export type SignInResult =
  | { kind: 'COMPLETE'; user: PublicUser }
  | { kind: 'TWO_FACTOR_REQUIRED'; challengeId: string; expiresAt: string };
