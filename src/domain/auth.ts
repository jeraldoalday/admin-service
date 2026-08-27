import { recordAuditLog } from './audit';
import { getDatabase, mutate } from './database';
import { ConflictError, TooManyRequestsError, UnauthorizedError } from './errors';
import { requireActor, type Actor } from './guards';
import { createId, nowIso } from './ids';
import { lockStateFor, recordSignInAttempt } from './lockout';
import { hashPassword, verifyPassword } from './password';
import type { PublicUser, UserRecord } from './types';
import {
  changePasswordSchema,
  loginSchema,
  parseInput,
  registerSchema,
  updateProfileSchema,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
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
 * Weighs a set of credentials, and writes down that it did.
 *
 * Every path out of here records an attempt, which is what gives the throttle something to
 * count and the account holder something to read. The lock is checked before the password
 * is, so a locked address costs nothing to refuse and the refusal cannot be timed against a
 * successful verification to learn whether the password was right.
 */
export function loginUser(input: LoginInput): PublicUser {
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

  recordSignInAttempt({ ...attempt, outcome: 'SUCCEEDED' });
  return toPublicUser(user);
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

  recordAuditLog({
    actorId: user.id,
    action: 'user.password_changed',
    targetType: 'user',
    targetId: user.id,
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
