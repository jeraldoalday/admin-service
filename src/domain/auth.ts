import { getDatabase, mutate } from './database';
import { ConflictError, UnauthorizedError } from './errors';
import { createId, nowIso } from './ids';
import { hashPassword, verifyPassword } from './password';
import type { PublicUser, UserRecord } from './types';
import {
  loginSchema,
  parseInput,
  registerSchema,
  type LoginInput,
  type RegisterInput,
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

  return mutate((db) => {
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
}

export function loginUser(input: LoginInput): PublicUser {
  const parsed = parseInput(loginSchema, input);
  const user = findUserByEmail(parsed.email);

  // Same message whether the account is missing or the password is wrong, so the form
  // cannot be used to enumerate which emails have accounts.
  if (!user || !verifyPassword(parsed.password, user.passwordHash)) {
    throw new UnauthorizedError('Invalid email or password');
  }

  if (!user.isActive) {
    throw new UnauthorizedError('This account has been deactivated');
  }

  return toPublicUser(user);
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
