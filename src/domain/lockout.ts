import { recordAuditLog } from './audit';
import { getDatabase, mutate } from './database';
import { NotFoundError } from './errors';
import { requireActor, requireAdmin, type Actor } from './guards';
import { createId, nowIso } from './ids';
import { paginate, sortNewestFirst, type PaginatedResult } from './pagination';
import type {
  AccountLockView,
  SignInAttemptRecord,
  SignInAttemptView,
  SignInOutcome,
} from './types';
import {
  listSignInAttemptsQuerySchema,
  parseInput,
  type ListSignInAttemptsQuery,
} from './validation';

/**
 * Sign-in throttling.
 *
 * A password form that will weigh an unlimited number of guesses is a password form that
 * will eventually be guessed, and the console's own bcrypt work factor only makes each guess
 * slower rather than finite. Five failures inside a quarter of an hour close the address off.
 *
 * The lock is derived from the attempt rows rather than stored as a flag on the account, in
 * the same spirit as an invite's or an API key's expiry. Nothing has to rewrite the account
 * when it locks, nothing has to rewrite it again when the lock lapses, and — the part that
 * actually matters when somebody asks why they cannot get in — the evidence for the lock is
 * still sitting there to be read afterwards.
 *
 * There is deliberately no separate lockout duration. The lock is exactly "five failures are
 * currently in the window", so it opens again the moment the fifth-newest of them ages out.
 * A duration bolted on beside the window would be a second, slightly different answer to the
 * same question, and the two would drift.
 */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

/**
 * How many attempts are kept per address. The history is a security aid, not an archive: far
 * enough back to show the run of failures that locked an account and the sign-in that came
 * after it, and not so far that a demo console hoards every keystroke anybody ever mistyped.
 */
export const ATTEMPTS_RETAINED_PER_EMAIL = 25;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toAttemptView(attempt: SignInAttemptRecord): SignInAttemptView {
  const { id, email, userId, outcome, clearedAt, createdAt } = attempt;
  return { id, email, userId, outcome, clearedAt, createdAt };
}

function attemptsFor(email: string): SignInAttemptRecord[] {
  return sortNewestFirst(getDatabase().signInAttempts.filter((attempt) => attempt.email === email));
}

/**
 * The failures currently counting against an address, newest first.
 *
 * Walking back from the most recent attempt stops at the first thing that ends the run: an
 * attempt older than the window, a successful sign-in — proving whoever it was does know the
 * password — or a failure an administrator has cleared. A BLOCKED attempt is skipped rather
 * than counted, because it is the lock's own echo: counting it would let somebody extend
 * their own lockout indefinitely by continuing to knock, and the fifteen minutes would never
 * start running down.
 */
function countingFailures(email: string, now: number): SignInAttemptRecord[] {
  const cutoff = now - LOCKOUT_WINDOW_MS;
  const counted: SignInAttemptRecord[] = [];

  for (const attempt of attemptsFor(email)) {
    if (Date.parse(attempt.createdAt) < cutoff) break;
    if (attempt.clearedAt || attempt.outcome === 'SUCCEEDED') break;
    if (attempt.outcome === 'FAILED') counted.push(attempt);
  }
  return counted;
}

/**
 * The lock state of one address, whether or not an account holds it. An address nobody has
 * registered locks exactly like one that exists, since the sign-in form refuses to say which
 * it is looking at and a throttle that only applied to real accounts would say it for us.
 */
export function lockStateFor(email: string, now = Date.now()): AccountLockView {
  const normalized = normalizeEmail(email);
  const failures = countingFailures(normalized, now);
  const threshold = failures[MAX_FAILED_ATTEMPTS - 1];

  return {
    email: normalized,
    isLocked: threshold !== undefined,
    failedAttempts: failures.length,
    retriesRemaining: Math.max(0, MAX_FAILED_ATTEMPTS - failures.length),
    // The instant the oldest failure still holding the lock shut falls out of the window,
    // which is the same instant the count drops back under the threshold.
    lockedUntil: threshold
      ? new Date(Date.parse(threshold.createdAt) + LOCKOUT_WINDOW_MS).toISOString()
      : null,
  };
}

export function isLocked(email: string, now = Date.now()): boolean {
  return lockStateFor(email, now).isLocked;
}

/** The lock state of an account, looked up by id rather than by address. */
export function lockStateForUser(userId: string, now = Date.now()): AccountLockView | null {
  const user = getDatabase().users.find((candidate) => candidate.id === userId);
  return user ? lockStateFor(user.email, now) : null;
}

/**
 * Writes down that somebody tried. Every path out of sign-in lands here, which is what makes
 * the history a record rather than a sample of the interesting cases.
 *
 * The address is kept even when no account holds it: a run of attempts against an address
 * nobody has registered is one of the few things in this table worth noticing on its own.
 */
export function recordSignInAttempt(input: {
  email: string;
  userId: string | null;
  outcome: SignInOutcome;
}): SignInAttemptRecord {
  const email = normalizeEmail(input.email);

  const attempt = mutate((db) => {
    const record: SignInAttemptRecord = {
      id: createId(),
      email,
      userId: input.userId,
      outcome: input.outcome,
      clearedAt: null,
      createdAt: nowIso(),
    };
    db.signInAttempts.push(record);

    const forEmail = db.signInAttempts.filter((candidate) => candidate.email === email);
    if (forEmail.length > ATTEMPTS_RETAINED_PER_EMAIL) {
      const keep = new Set(
        sortNewestFirst(forEmail)
          .slice(0, ATTEMPTS_RETAINED_PER_EMAIL)
          .map((candidate) => candidate.id),
      );
      db.signInAttempts = db.signInAttempts.filter(
        (candidate) => candidate.email !== email || keep.has(candidate.id),
      );
    }
    return record;
  });

  // The entry is written when the threshold is crossed and not on every failure after it,
  // so the log says "this account locked at 14:02" rather than repeating itself for as long
  // as somebody keeps knocking.
  if (input.outcome === 'FAILED' && lockStateFor(email).failedAttempts === MAX_FAILED_ATTEMPTS) {
    recordAuditLog({
      actorId: null,
      action: 'user.locked',
      targetType: 'user',
      targetId: input.userId,
      metadata: { email, failedAttempts: MAX_FAILED_ATTEMPTS },
    });
  }

  return attempt;
}

/**
 * Clears the failures currently holding an address shut. The rows stay in the table with a
 * `clearedAt` stamp rather than being deleted: an unlock that erased the run of failures
 * that caused it would leave the next reader unable to tell a quiet week from a busy one
 * somebody tidied up after.
 */
function clearFailures(email: string, now: number): number {
  const failures = countingFailures(email, now);
  if (failures.length === 0) return 0;

  return mutate(() => {
    const timestamp = nowIso();
    failures.forEach((attempt) => {
      attempt.clearedAt = timestamp;
    });
    return failures.length;
  });
}

/**
 * Lets an administrator open an account back up before its lock lapses on its own — the
 * "it was me, I mistyped it five times" case, which otherwise costs the account holder a
 * quarter of an hour of not being able to work.
 */
export function unlockAccount(actor: Actor, userId: string): AccountLockView {
  const admin = requireAdmin(actor);

  const user = getDatabase().users.find((candidate) => candidate.id === userId);
  if (!user) {
    throw new NotFoundError('User not found');
  }

  const cleared = clearFailures(user.email, Date.now());

  recordAuditLog({
    actorId: admin.id,
    action: 'user.unlocked',
    targetType: 'user',
    targetId: user.id,
    metadata: { email: user.email, clearedAttempts: cleared },
  });

  return lockStateFor(user.email);
}

function matchesQuery(
  attempt: SignInAttemptRecord,
  query: { outcome?: SignInOutcome | undefined; email?: string | undefined },
): boolean {
  if (query.outcome && attempt.outcome !== query.outcome) return false;
  if (query.email && !attempt.email.includes(query.email)) return false;
  return true;
}

/** Every sign-in attempt on the platform, for an administrator looking into one. */
export function listSignInAttempts(
  actor: Actor,
  rawQuery: ListSignInAttemptsQuery = {},
): PaginatedResult<SignInAttemptView> {
  requireAdmin(actor);
  const query = parseInput(listSignInAttemptsQuerySchema, rawQuery);
  const matching = getDatabase().signInAttempts.filter((attempt) => matchesQuery(attempt, query));

  return paginate(sortNewestFirst(matching).map(toAttemptView), query);
}

/**
 * The attempts made against your own account, which needs no admin rights: "was that you?"
 * is a question the account holder is the best placed person to answer, and the fastest way
 * to have a stolen password noticed is to show its owner the attempts.
 *
 * Matching is by address rather than by user id so that the failures made before the account
 * was resolved — every attempt against an address the store had not yet looked up — are part
 * of what its owner sees.
 */
export function listOwnSignInAttempts(
  actor: Actor,
  rawQuery: ListSignInAttemptsQuery = {},
): PaginatedResult<SignInAttemptView> {
  const current = requireActor(actor);
  const query = parseInput(listSignInAttemptsQuerySchema, rawQuery);

  const user = getDatabase().users.find((candidate) => candidate.id === current.id);
  if (!user) {
    return paginate([], query);
  }

  const matching = getDatabase().signInAttempts.filter(
    (attempt) => attempt.email === user.email && matchesQuery(attempt, query),
  );

  return paginate(sortNewestFirst(matching).map(toAttemptView), query);
}
