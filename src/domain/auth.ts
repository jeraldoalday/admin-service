import { recordAuditLog } from './audit';
import { getDatabase, mutate } from './database';
import { ConflictError, TooManyRequestsError, UnauthorizedError } from './errors';
import { requireActor, type Actor } from './guards';
import { createId, createToken, nowIso } from './ids';
import { lockStateFor, recordSignInAttempt } from './lockout';
import { hashPassword, verifyPassword } from './password';
import { revokeSessionsForUser } from './sessions';
import { consumeTwoFactorCode, isTwoFactorEnabled } from './twoFactor';
import type { PublicUser, SignInChallengeRecord, SignInResult, UserRecord } from './types';
import {
  changePasswordSchema,
  loginSchema,
  parseInput,
  registerSchema,
  twoFactorChallengeSchema,
  updateProfileSchema,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
  type TwoFactorChallengeInput,
  type UpdateProfileInput,
} from './validation';

export function toPublicUser(user: UserRecord): PublicUser {
  const { id, email, displayName, role, createdAt } = user;
  return { id, email, displayName, role, createdAt };
}

export function findUserByEmail(email: string): UserRecord | undefined {
  const normalized = email.trim().toLowerCase();
  return getDatabase().users.find((user) => user.email === normalized);
}

export function findUserById(id: string): UserRecord | undefined {
  return getDatabase().users.find((user) => user.id === id);
}

/**
 * Creates an account and signs it in. The first account ever created becomes an `ADMIN` —
 * without a seeded operator there would otherwise be no way to reach the admin screens.
 */
export function registerUser(input: RegisterInput): PublicUser {
  const parsed = parseInput(registerSchema, input);

  if (findUserByEmail(parsed.email)) {
    throw new ConflictError('An account with this email already exists');
  }

  const created = mutate((db) => {
    const timestamp = nowIso();
    const user: UserRecord = {
      id: createId(),
      email: parsed.email,
      passwordHash: hashPassword(parsed.password),
      displayName: parsed.displayName,
      role: db.users.length === 0 ? 'ADMIN' : 'MEMBER',
      isActive: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.users.push(user);
    return toPublicUser(user);
  });

  // Registration is a mutation like any other, and the one that brings an account into
  // existence at that. Leaving it out made the log's own claim to be a complete record
  // false: an account could appear on the users screen with nothing in the trail saying
  // where it came from, and the first admin — the account that can read the trail — was
  // itself the least accounted-for row in it. The account is its own actor, which is the
  // truth of a self-service registration.
  recordAuditLog({
    actorId: created.id,
    action: 'user.registered',
    targetType: 'user',
    targetId: created.id,
    metadata: { email: created.email, role: created.role },
  });

  return created;
}

/**
 * How long a half-finished sign-in stays open.
 *
 * Long enough to find a phone that is in another room, short enough that a challenge left
 * behind on a shared machine is worthless by the time anybody else sits down at it. It is
 * minutes rather than the session's days on purpose: a challenge is a promise that somebody
 * knew the password a moment ago, and that promise should not outlive the moment.
 */
export const SIGN_IN_CHALLENGE_TTL_MS = 5 * 60 * 1000;

function createSignInChallenge(userId: string): SignInChallengeRecord {
  return mutate((db) => {
    const challenge: SignInChallengeRecord = {
      // A random token rather than a sequential id, for the same reason a session id is one:
      // it is the only thing standing between the second step and the account.
      id: createToken(18),
      userId,
      expiresAt: new Date(Date.now() + SIGN_IN_CHALLENGE_TTL_MS).toISOString(),
      consumedAt: null,
      createdAt: nowIso(),
    };
    db.signInChallenges.push(challenge);
    return challenge;
  });
}

/** The challenge behind an id, or null when it is spent, lapsed, or was never there. */
function resolveSignInChallenge(
  challengeId: string,
  now = Date.now(),
): SignInChallengeRecord | null {
  const challenge = getDatabase().signInChallenges.find(
    (candidate) => candidate.id === challengeId,
  );
  if (!challenge || challenge.consumedAt || Date.parse(challenge.expiresAt) <= now) return null;
  return challenge;
}

/**
 * Weighs a set of credentials, and writes down that it did.
 *
 * The lock is checked before the password is, so a locked address costs nothing to refuse
 * and the refusal cannot be timed against a successful verification to learn whether the
 * password was right.
 *
 * A correct password against an account with an authenticator records *nothing* and returns
 * a challenge instead. That is the one deliberate gap in "every path out of here records an
 * attempt": knowing the password is not signing in when a second factor is required, and an
 * attempt logged as SUCCEEDED for somebody who never produced a code would be a line in the
 * account holder's own security panel telling them a sign-in happened that did not. The
 * attempt is recorded when the sign-in actually resolves, one way or the other — which also
 * puts code guessing under the same throttle as password guessing, since each wrong code is
 * a FAILED attempt against the address.
 */
export function loginUser(input: LoginInput): SignInResult {
  const parsed = parseInput(loginSchema, input);
  const user = findUserByEmail(parsed.email);
  const attempt = { email: parsed.email, userId: user?.id ?? null };

  const lock = lockStateFor(parsed.email);
  if (lock.isLocked) {
    recordSignInAttempt({ ...attempt, outcome: 'BLOCKED' });
    throw new TooManyRequestsError('Too many failed sign-in attempts. Try again in a few minutes.');
  }

  // Same message whether the account is missing or the password is wrong, so the form
  // cannot be used to enumerate which emails have accounts.
  if (!user || !verifyPassword(parsed.password, user.passwordHash)) {
    recordSignInAttempt({ ...attempt, outcome: 'FAILED' });
    throw new UnauthorizedError('Invalid email or password');
  }

  if (!user.isActive) {
    // Recorded as BLOCKED rather than FAILED: the password was right, and counting this
    // would leave a deactivated account locked as well by the time anyone reactivated it.
    recordSignInAttempt({ ...attempt, outcome: 'BLOCKED' });
    throw new UnauthorizedError('This account has been deactivated');
  }

  if (isTwoFactorEnabled(user.id)) {
    const challenge = createSignInChallenge(user.id);
    return {
      kind: 'TWO_FACTOR_REQUIRED',
      challengeId: challenge.id,
      expiresAt: challenge.expiresAt,
    };
  }

  recordSignInAttempt({ ...attempt, outcome: 'SUCCEEDED' });
  return { kind: 'COMPLETE', user: toPublicUser(user) };
}

/**
 * Answers a challenge with a code, and finishes the sign-in.
 *
 * The account is re-read rather than trusted from the challenge: five minutes is long enough
 * for an administrator to have deactivated it, and a sign-in that completes into an account
 * somebody has just switched off would be the deactivation quietly failing.
 *
 * A wrong code leaves the challenge open, so somebody who fat-fingered a digit can simply
 * type it again — the lockout is what bounds the guessing, and it is already counting. What
 * a wrong code does not get is a second life for the *code*: the domain spends both kinds on
 * use, so a correct one cannot be replayed even while it is still inside its window.
 */
export function completeTwoFactorSignIn(rawInput: TwoFactorChallengeInput): PublicUser {
  const input = parseInput(twoFactorChallengeSchema, rawInput);

  const challenge = resolveSignInChallenge(input.challengeId);
  if (!challenge) {
    throw new UnauthorizedError('That sign-in has expired. Enter your password again.');
  }

  const user = findUserById(challenge.userId);
  const attempt = { email: user?.email ?? '', userId: challenge.userId };

  if (!user || !user.isActive) {
    recordSignInAttempt({ ...attempt, outcome: 'BLOCKED' });
    throw new UnauthorizedError('This account has been deactivated');
  }

  if (lockStateFor(user.email).isLocked) {
    recordSignInAttempt({ ...attempt, outcome: 'BLOCKED' });
    throw new TooManyRequestsError('Too many failed sign-in attempts. Try again in a few minutes.');
  }

  const factor = consumeTwoFactorCode(user.id, input.code);
  if (!factor) {
    recordSignInAttempt({ ...attempt, outcome: 'FAILED' });
    throw new UnauthorizedError('That code is not right. Check your authenticator and try again.');
  }

  mutate(() => {
    challenge.consumedAt = nowIso();
  });

  recordSignInAttempt({ ...attempt, outcome: 'SUCCEEDED' });
  return toPublicUser(user);
}

/**
 * Drops the challenges that lapsed while nobody was looking, and reports how many.
 *
 * Reads already refuse a lapsed challenge, so nothing depends on this having run. What it
 * buys is that the table does not accumulate a row for every sign-in anybody abandoned:
 * unlike an invite or a session, a spent challenge has nothing left to tell anybody, so it
 * is deleted rather than stamped.
 */
export function expireStaleSignInChallenges(now = Date.now()): number {
  const stale = getDatabase().signInChallenges.filter(
    (challenge) => challenge.consumedAt || Date.parse(challenge.expiresAt) <= now,
  );
  if (stale.length === 0) return 0;

  const ids = new Set(stale.map((challenge) => challenge.id));
  mutate((db) => {
    db.signInChallenges = db.signInChallenges.filter((challenge) => !ids.has(challenge.id));
  });

  return stale.length;
}

/**
 * Resolves the account behind a session for a write it is making to itself. A session
 * pointing at an account that has since been deleted or deactivated is refused here rather
 * than allowed to write through a stale identity.
 */
function requireOwnAccount(actor: Actor): UserRecord {
  const current = requireActor(actor);
  const user = findUserById(current.id);
  if (!user || !user.isActive) {
    throw new UnauthorizedError('This session is no longer valid');
  }
  return user;
}

/** Renames your own account. Role and active status stay admin-only, deliberately. */
export function updateProfile(actor: Actor, rawInput: UpdateProfileInput): PublicUser {
  const user = requireOwnAccount(actor);
  const input = parseInput(updateProfileSchema, rawInput);

  const updated = mutate(() => {
    user.displayName = input.displayName;
    user.updatedAt = nowIso();
    return toPublicUser(user);
  });

  recordAuditLog({
    actorId: user.id,
    action: 'user.profile_updated',
    targetType: 'user',
    targetId: user.id,
    metadata: { displayName: input.displayName },
  });

  return updated;
}

/**
 * Changes your own password, which requires proving you know the current one — a session
 * left open on a shared machine should not be enough to lock its owner out of the account.
 * The audit entry records that it happened and nothing about either password.
 *
 * Every other session the account has is ended by the change. Somebody changing a password
 * is very often changing it *because* they think somebody else has it, and a new password
 * that leaves the intruder's session untouched has not actually shut anyone out. The session
 * making the change is spared, since being signed out of the machine you are sitting at is
 * indistinguishable, from where you are sitting, from the change having failed.
 */
export function changePassword(actor: Actor, rawInput: ChangePasswordInput): PublicUser {
  const user = requireOwnAccount(actor);
  const input = parseInput(changePasswordSchema, rawInput);

  if (!verifyPassword(input.currentPassword, user.passwordHash)) {
    throw new UnauthorizedError('Your current password is incorrect');
  }

  const updated = mutate(() => {
    user.passwordHash = hashPassword(input.newPassword);
    user.updatedAt = nowIso();
    return toPublicUser(user);
  });

  const revokedSessions = revokeSessionsForUser(user.id, user.id, {
    exceptSessionId: actor?.sessionId,
  });

  recordAuditLog({
    actorId: user.id,
    action: 'user.password_changed',
    targetType: 'user',
    targetId: user.id,
    ...(revokedSessions > 0 ? { metadata: { revokedSessions } } : {}),
  });

  return updated;
}

/**
 * Resolves the signed-in user for a restored session. Returns null when the account has been
 * deleted or deactivated since the session was stored, which signs the stale session out.
 */
export function resumeSession(userId: string): PublicUser | null {
  const user = findUserById(userId);
  if (!user || !user.isActive) return null;
  return toPublicUser(user);
}
