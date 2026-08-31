import { recordAuditLog } from './audit';
import { getDatabase, mutate } from './database';
import { BadRequestError, ConflictError, NotFoundError, UnauthorizedError } from './errors';
import { requireActor, requireAdmin, type Actor } from './guards';
import { createId, nowIso } from './ids';
import { verifyPassword } from './password';
import { sha256Hex } from './sha256';
import { otpauthUri, timeStepAt, verifyCode } from './totp';
import type {
  RecoveryCodeRecord,
  TwoFactorActivationView,
  TwoFactorEnrolmentView,
  TwoFactorRecord,
  TwoFactorStatus,
  TwoFactorView,
  UserRecord,
} from './types';
import {
  confirmTwoFactorSchema,
  parseInput,
  twoFactorPasswordSchema,
  type ConfirmTwoFactorInput,
  type TwoFactorPasswordInput,
} from './validation';
import { groupBase32, randomBase32Secret } from '@/lib/base32';

/**
 * Two-factor authentication.
 *
 * The password rules in this console are already about as good as password rules get — they
 * are bcrypt-hashed, the sign-in form refuses to enumerate accounts, and five failures close
 * an address off. None of that helps against a password that has simply been reused
 * somewhere it should not have been, which is how administrator accounts are actually taken.
 * A second factor is the answer to that specific problem and to no other, which is why it
 * sits beside the throttle rather than replacing any part of it.
 *
 * Enrolment is deliberately two steps. The secret has to be stored before the first code can
 * be checked against it — the codes are derived from it, so there is nothing else to check
 * against — but a stored secret that immediately started being required at sign-in would
 * lock out everybody who scanned a QR code, put their phone down, and closed the tab.
 * Nothing is enforced until a correct code proves that the phone and the console agree about
 * what the secret is and roughly what time it is.
 */

/** What an authenticator app calls this account. */
export const TWO_FACTOR_ISSUER = 'admin-service';

/**
 * How many recovery codes an enrolment mints.
 *
 * Ten is enough that somebody can lose a few and still get in, and few enough that the list
 * fits on the piece of paper it is meant to be written on. They are minted all at once and
 * shown once, rather than issued on demand: a code the console can hand out again is a code
 * an attacker holding the session can hand to themselves.
 */
export const RECOVERY_CODE_COUNT = 10;

/**
 * The alphabet recovery codes are drawn from — thirty-two characters with `I`, `O`, `0`, and
 * `1` left out, so a code read off paper cannot be mistyped into a different valid code.
 * Thirty-two divides 256 exactly, which is what lets a random byte be masked down to a
 * character without skewing the distribution.
 */
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const RECOVERY_GROUP = 5;

function randomRecoveryCode(): string {
  const bytes = new Uint8Array(RECOVERY_GROUP * 2);
  globalThis.crypto.getRandomValues(bytes);

  const characters = Array.from(bytes, (byte) => RECOVERY_ALPHABET[byte & 0x1f] as string);
  return `${characters.slice(0, RECOVERY_GROUP).join('')}-${characters.slice(RECOVERY_GROUP).join('')}`;
}

/** Uppercased and stripped of the separators, so a code works however it was transcribed. */
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * The digest a recovery code is stored under.
 *
 * The account id goes into the hash, which makes it a per-account salt that costs nothing:
 * the same code issued twice to two accounts stores as two unrelated digests, so one
 * precomputed table cannot cover the whole table. Recovery codes carry fifty bits and are
 * generated rather than chosen, so this is belt-and-braces — but it is the kind of
 * belt-and-braces that is free to put on now and impossible to retrofit later.
 */
function recoveryCodeHash(userId: string, code: string): string {
  return sha256Hex(`${userId}:${normalizeRecoveryCode(code)}`);
}

function twoFactorRecordFor(userId: string): TwoFactorRecord | undefined {
  return getDatabase().twoFactor.find((record) => record.userId === userId);
}

function recoveryCodesFor(userId: string): RecoveryCodeRecord[] {
  return getDatabase().recoveryCodes.filter((record) => record.userId === userId);
}

export function twoFactorStatusFor(userId: string): TwoFactorStatus {
  const record = twoFactorRecordFor(userId);
  if (!record) return 'DISABLED';
  return record.confirmedAt ? 'ENABLED' : 'PENDING';
}

/**
 * Whether sign-in should ask this account for a second factor. A pending enrolment
 * deliberately answers no — see the note at the top of the file.
 */
export function isTwoFactorEnabled(userId: string): boolean {
  return twoFactorStatusFor(userId) === 'ENABLED';
}

function twoFactorViewFor(userId: string): TwoFactorView {
  const record = twoFactorRecordFor(userId);
  const codes = recoveryCodesFor(userId);

  return {
    status: twoFactorStatusFor(userId),
    confirmedAt: record?.confirmedAt ?? null,
    remainingRecoveryCodes: codes.filter((code) => !code.usedAt).length,
    totalRecoveryCodes: codes.length,
  };
}

/**
 * Resolves the account behind a session for a write it is making to itself, the same way the
 * profile and password forms do: a session pointing at an account that has since been
 * deleted or deactivated is refused rather than allowed to write through a stale identity.
 */
function requireOwnAccount(actor: Actor): UserRecord {
  const current = requireActor(actor);
  const user = getDatabase().users.find((candidate) => candidate.id === current.id);
  if (!user || !user.isActive) {
    throw new UnauthorizedError('This session is no longer valid');
  }
  return user;
}

function requirePassword(user: UserRecord, rawInput: TwoFactorPasswordInput): void {
  const input = parseInput(twoFactorPasswordSchema, rawInput);
  if (!verifyPassword(input.password, user.passwordHash)) {
    throw new UnauthorizedError('Your password is incorrect');
  }
}

/** Your own authenticator's state, which is the only one you are entitled to ask about. */
export function getTwoFactor(actor: Actor): TwoFactorView {
  const current = requireActor(actor);
  return twoFactorViewFor(current.id);
}

/**
 * Starts an enrolment, handing back the secret and the URI a QR code encodes.
 *
 * Asking again while an enrolment is already pending replaces the secret rather than
 * returning the old one. Somebody who comes back to this screen is nearly always somebody
 * whose first attempt went wrong — a half-scanned code, a phone they have since wiped — and
 * handing them the secret their app may or may not still hold is how an enrolment ends up
 * confirmed against the wrong entry. An enrolment that is already confirmed is refused
 * outright: replacing a working authenticator is a disable followed by an enrol, and both
 * halves of that cost a password.
 */
export function beginTwoFactorEnrolment(actor: Actor): TwoFactorEnrolmentView {
  const user = requireOwnAccount(actor);

  if (twoFactorStatusFor(user.id) === 'ENABLED') {
    throw new ConflictError('Two-factor authentication is already set up for this account');
  }

  const secret = randomBase32Secret();

  mutate((db) => {
    const timestamp = nowIso();
    db.twoFactor = db.twoFactor.filter((record) => record.userId !== user.id);
    db.twoFactor.push({
      id: createId(),
      userId: user.id,
      secret,
      confirmedAt: null,
      lastUsedStep: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });

  // A secret written to the store is a mutation, and the log claims to hold every one of
  // them. It records that an enrolment began and nothing about the secret itself.
  recordAuditLog({
    actorId: user.id,
    action: 'user.two_factor_enrolment_started',
    targetType: 'user',
    targetId: user.id,
  });

  return {
    secret,
    formattedSecret: groupBase32(secret.replace(/=+$/, '')),
    otpauthUri: otpauthUri({ secret, account: user.email, issuer: TWO_FACTOR_ISSUER }),
  };
}

/**
 * Turns a pending enrolment into a live one, on the strength of a code from the phone.
 *
 * The confirming step is recorded as the replay floor straight away, so the code somebody
 * has just typed into this form cannot be typed into the sign-in form by whoever was reading
 * over their shoulder while it was still inside its window.
 */
export function confirmTwoFactorEnrolment(
  actor: Actor,
  rawInput: ConfirmTwoFactorInput,
): TwoFactorActivationView {
  const user = requireOwnAccount(actor);
  const input = parseInput(confirmTwoFactorSchema, rawInput);

  const record = twoFactorRecordFor(user.id);
  if (!record) {
    throw new NotFoundError('Start setting up two-factor authentication first');
  }
  if (record.confirmedAt) {
    throw new ConflictError('Two-factor authentication is already set up for this account');
  }

  const step = verifyCode(record.secret, input.code);
  if (step === null) {
    throw new BadRequestError('That code is not right. Check your authenticator and try again.');
  }

  mutate(() => {
    const timestamp = nowIso();
    record.confirmedAt = timestamp;
    record.lastUsedStep = step;
    record.updatedAt = timestamp;
  });

  const recoveryCodes = replaceRecoveryCodes(user.id);

  recordAuditLog({
    actorId: user.id,
    action: 'user.two_factor_enabled',
    targetType: 'user',
    targetId: user.id,
    metadata: { recoveryCodes: recoveryCodes.length },
  });

  return { twoFactor: twoFactorViewFor(user.id), recoveryCodes };
}

/**
 * Mints a fresh set of recovery codes, discarding whatever was there.
 *
 * The old ones go rather than being kept alongside: a set somebody regenerates because they
 * think the printout has been seen is not a set that should still work. The plaintext is
 * returned here and nowhere else — from this point the store holds digests only.
 */
function replaceRecoveryCodes(userId: string): string[] {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, randomRecoveryCode);

  mutate((db) => {
    const timestamp = nowIso();
    db.recoveryCodes = db.recoveryCodes.filter((record) => record.userId !== userId);
    codes.forEach((code) => {
      db.recoveryCodes.push({
        id: createId(),
        userId,
        codeHash: recoveryCodeHash(userId, code),
        usedAt: null,
        createdAt: timestamp,
      });
    });
  });

  return codes;
}

/** A new set of recovery codes for an account that still has its authenticator. */
export function regenerateRecoveryCodes(
  actor: Actor,
  rawInput: TwoFactorPasswordInput,
): TwoFactorActivationView {
  const user = requireOwnAccount(actor);
  requirePassword(user, rawInput);

  if (!isTwoFactorEnabled(user.id)) {
    throw new ConflictError('Two-factor authentication is not set up for this account');
  }

  const recoveryCodes = replaceRecoveryCodes(user.id);

  recordAuditLog({
    actorId: user.id,
    action: 'user.two_factor_recovery_codes_replaced',
    targetType: 'user',
    targetId: user.id,
    metadata: { recoveryCodes: recoveryCodes.length },
  });

  return { twoFactor: twoFactorViewFor(user.id), recoveryCodes };
}

/**
 * Removes the authenticator and every recovery code with it.
 *
 * The codes go because they are the authenticator: leaving ten live ones behind after
 * somebody has turned two-factor off would mean a slip of paper in a drawer still opening an
 * account whose owner believes it is back to a password alone.
 */
function removeTwoFactor(userId: string): void {
  mutate((db) => {
    db.twoFactor = db.twoFactor.filter((record) => record.userId !== userId);
    db.recoveryCodes = db.recoveryCodes.filter((record) => record.userId !== userId);
  });
}

/** Turns your own authenticator off, at the cost of your password. */
export function disableTwoFactor(actor: Actor, rawInput: TwoFactorPasswordInput): TwoFactorView {
  const user = requireOwnAccount(actor);
  requirePassword(user, rawInput);

  const status = twoFactorStatusFor(user.id);
  if (status === 'DISABLED') {
    throw new ConflictError('Two-factor authentication is not set up for this account');
  }

  removeTwoFactor(user.id);

  recordAuditLog({
    actorId: user.id,
    action: 'user.two_factor_disabled',
    targetType: 'user',
    targetId: user.id,
    // Whether an enrolment was abandoned half-finished or a working authenticator was taken
    // off is the difference between housekeeping and a security event, and only the entry
    // can still tell them apart afterwards.
    metadata: { previousStatus: status },
  });

  return twoFactorViewFor(user.id);
}

/**
 * An administrator taking somebody's authenticator off for them.
 *
 * This is the lost-phone-and-lost-codes case, and it has to exist: the alternative is an
 * account nobody on the platform can open, which is a worse outcome than an administrator
 * being able to remove a factor — they can already deactivate the account, change its role,
 * and read everything it can see. What makes it safe enough to offer is that it is loud. The
 * entry names the administrator, and the account holder can see on their own screen that the
 * authenticator they set up is gone.
 */
export function disableTwoFactorForUser(actor: Actor, userId: string): TwoFactorView {
  const admin = requireAdmin(actor);

  const user = getDatabase().users.find((candidate) => candidate.id === userId);
  if (!user) {
    throw new NotFoundError('User not found');
  }

  const status = twoFactorStatusFor(userId);
  if (status === 'DISABLED') {
    throw new ConflictError('Two-factor authentication is not set up for this account');
  }

  removeTwoFactor(userId);

  recordAuditLog({
    actorId: admin.id,
    action: 'user.two_factor_reset',
    targetType: 'user',
    targetId: userId,
    metadata: { email: user.email, previousStatus: status },
  });

  return twoFactorViewFor(userId);
}

/** Drops an account's authenticator along with the account itself. */
export function deleteTwoFactorForUser(userId: string): void {
  removeTwoFactor(userId);
}

/** Which kind of code got somebody in, which is worth saying out loud in the audit trail. */
export type TwoFactorFactor = 'TOTP' | 'RECOVERY_CODE';

/**
 * Weighs a code against an account's authenticator, and spends it.
 *
 * Both kinds are single-use, by two different mechanisms that amount to the same promise. A
 * time-based code moves the replay floor past its own step, so it cannot be presented again
 * inside the half-minute it stays mathematically valid. A recovery code is stamped used, so
 * it cannot be presented again at all.
 *
 * A recovery code is only tried once the time-based one has failed, and only against codes
 * that have not been spent. Order matters here: trying recovery codes first would let a
 * six-digit collision burn one.
 */
export function consumeTwoFactorCode(
  userId: string,
  code: string,
  now = Date.now(),
): TwoFactorFactor | null {
  const record = twoFactorRecordFor(userId);
  if (!record || !record.confirmedAt) return null;

  const step = verifyCode(record.secret, code, { now });
  if (step !== null) {
    // A step at or below the floor is a code that has already been spent — the same one
    // typed twice, or one somebody else read while it was still on screen.
    if (record.lastUsedStep !== null && step <= record.lastUsedStep) return null;

    mutate(() => {
      record.lastUsedStep = step;
      record.updatedAt = new Date(now).toISOString();
    });
    return 'TOTP';
  }

  const hash = recoveryCodeHash(userId, code);
  const recovery = getDatabase().recoveryCodes.find(
    (candidate) => candidate.userId === userId && !candidate.usedAt && candidate.codeHash === hash,
  );
  if (!recovery) return null;

  mutate(() => {
    recovery.usedAt = new Date(now).toISOString();
  });

  // Worth its own entry rather than being folded into the sign-in. Somebody spending a
  // recovery code has lost their phone, and a run of them is either an account in trouble or
  // an attacker working through a printout somebody left lying about.
  recordAuditLog({
    actorId: userId,
    action: 'user.two_factor_recovery_code_used',
    targetType: 'user',
    targetId: userId,
    metadata: { remaining: recoveryCodesFor(userId).filter((each) => !each.usedAt).length },
  });

  return 'RECOVERY_CODE';
}

/** The current time step, for a screen that wants to say how long a code has left. */
export function secondsUntilNextCode(now = Date.now()): number {
  return 30 - Math.floor(now / 1000) + timeStepAt(now) * 30;
}
