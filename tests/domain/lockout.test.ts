import { describe, expect, it } from 'vitest';
import { AppError, audit, auth, getDatabase, lockout } from '@/domain';
import { DEMO_PASSWORD, adminActor, danaActor, miraActor } from '../helpers';

const WRONG = 'not-the-password';

function failSignIn(email: string, times: number): void {
  for (let attempt = 0; attempt < times; attempt += 1) {
    expect(() => auth.loginUser({ email, password: WRONG })).toThrow();
  }
}

describe('counting failed sign-ins', () => {
  it('leaves an address open below the threshold', () => {
    failSignIn('mira@example.com', lockout.MAX_FAILED_ATTEMPTS - 1);

    const lock = lockout.lockStateFor('mira@example.com');
    expect(lock.isLocked).toBe(false);
    expect(lock.failedAttempts).toBe(lockout.MAX_FAILED_ATTEMPTS - 1);
    expect(lock.retriesRemaining).toBe(1);
    expect(lock.lockedUntil).toBeNull();
  });

  it('closes it on the attempt that reaches the threshold', () => {
    failSignIn('mira@example.com', lockout.MAX_FAILED_ATTEMPTS);

    const lock = lockout.lockStateFor('mira@example.com');
    expect(lock.isLocked).toBe(true);
    expect(lock.retriesRemaining).toBe(0);
    expect(Date.parse(lock.lockedUntil ?? '')).toBeGreaterThan(Date.now());
  });

  it('refuses the right password while the address is locked', () => {
    failSignIn('mira@example.com', lockout.MAX_FAILED_ATTEMPTS);

    expect(() => auth.loginUser({ email: 'mira@example.com', password: DEMO_PASSWORD })).toThrow(
      'Too many failed sign-in attempts',
    );
  });

  it('reports the refusal as a throttle rather than a bad password', () => {
    failSignIn('mira@example.com', lockout.MAX_FAILED_ATTEMPTS);

    try {
      auth.loginUser({ email: 'mira@example.com', password: DEMO_PASSWORD });
      expect.unreachable('the locked sign-in should have thrown');
    } catch (caught) {
      expect(caught).toBeInstanceOf(AppError);
      expect((caught as AppError).statusCode).toBe(429);
    }
  });

  it('locks an address no account holds, exactly like one that exists', () => {
    failSignIn('nobody@example.com', lockout.MAX_FAILED_ATTEMPTS);

    expect(lockout.lockStateFor('nobody@example.com').isLocked).toBe(true);
  });

  it('normalises the address so casing cannot sidestep the count', () => {
    failSignIn('MIRA@example.com', 3);
    failSignIn('mira@EXAMPLE.com', 2);

    expect(lockout.lockStateFor('mira@example.com').isLocked).toBe(true);
  });

  it('does not let a blocked attempt extend the lock', () => {
    failSignIn('mira@example.com', lockout.MAX_FAILED_ATTEMPTS);
    const before = lockout.lockStateFor('mira@example.com').lockedUntil;

    // Knocking again while locked is recorded, but must not push the expiry out — otherwise
    // somebody could keep their own address shut indefinitely by continuing to try.
    expect(() => auth.loginUser({ email: 'mira@example.com', password: WRONG })).toThrow();

    const after = lockout.lockStateFor('mira@example.com');
    expect(after.lockedUntil).toBe(before);
    expect(after.failedAttempts).toBe(lockout.MAX_FAILED_ATTEMPTS);
  });

  it('ignores failures that have aged out of the window', () => {
    failSignIn('mira@example.com', lockout.MAX_FAILED_ATTEMPTS);
    const later = Date.now() + lockout.LOCKOUT_WINDOW_MS + 1000;

    expect(lockout.lockStateFor('mira@example.com', later).isLocked).toBe(false);
    expect(lockout.lockStateFor('mira@example.com', later).failedAttempts).toBe(0);
  });

  it('wipes the slate once a sign-in succeeds', () => {
    failSignIn('mira@example.com', lockout.MAX_FAILED_ATTEMPTS - 1);
    auth.loginUser({ email: 'mira@example.com', password: DEMO_PASSWORD });

    expect(lockout.lockStateFor('mira@example.com').failedAttempts).toBe(0);
  });

  it('does not count an attempt on a deactivated account', () => {
    // Sam's password is right; the account is simply switched off. Counting these would leave
    // the account locked as well by the time anybody reactivated it.
    for (let attempt = 0; attempt < lockout.MAX_FAILED_ATTEMPTS; attempt += 1) {
      expect(() => auth.loginUser({ email: 'sam@example.com', password: DEMO_PASSWORD })).toThrow(
        'This account has been deactivated',
      );
    }

    expect(lockout.lockStateFor('sam@example.com').isLocked).toBe(false);
  });

  it('writes the lock into the audit log once, not on every knock', () => {
    failSignIn('mira@example.com', lockout.MAX_FAILED_ATTEMPTS + 3);

    expect(audit.listAllAuditLogs({ action: 'user.locked' })).toHaveLength(1);
  });
});

describe('the attempt history', () => {
  it('records every outcome, including the ones nobody has an account for', () => {
    failSignIn('nobody@example.com', 1);
    auth.loginUser({ email: 'mira@example.com', password: DEMO_PASSWORD });

    const admin = adminActor();
    const outcomes = lockout
      .listSignInAttempts(admin, { pageSize: 100 })
      .items.filter((attempt) => ['nobody@example.com', 'mira@example.com'].includes(attempt.email))
      .map((attempt) => attempt.outcome);

    expect(outcomes).toContain('FAILED');
    expect(outcomes).toContain('SUCCEEDED');
  });

  it('keeps only the most recent attempts for an address', () => {
    failSignIn('nobody@example.com', lockout.ATTEMPTS_RETAINED_PER_EMAIL + 5);

    const held = getDatabase().signInAttempts.filter(
      (attempt) => attempt.email === 'nobody@example.com',
    );
    expect(held).toHaveLength(lockout.ATTEMPTS_RETAINED_PER_EMAIL);
  });

  it('filters by outcome and by address', () => {
    const admin = adminActor();
    failSignIn('nobody@example.com', 2);

    const failures = lockout.listSignInAttempts(admin, {
      email: 'nobody@example.com',
      outcome: 'FAILED',
    });
    expect(failures.total).toBe(2);
    expect(failures.items.every((attempt) => attempt.email === 'nobody@example.com')).toBe(true);
  });

  it('is admin-only across the platform', () => {
    expect(() => lockout.listSignInAttempts(danaActor())).toThrow(
      'You do not have permission to perform this action',
    );
  });

  it('shows an account holder their own attempts without any admin rights', () => {
    failSignIn('mira@example.com', 2);

    const own = lockout.listOwnSignInAttempts(miraActor());
    expect(own.total).toBeGreaterThanOrEqual(2);
    expect(own.items.every((attempt) => attempt.email === 'mira@example.com')).toBe(true);
  });

  it('does not show one account holder another account’s attempts', () => {
    failSignIn('mira@example.com', 2);

    expect(lockout.listOwnSignInAttempts(danaActor()).items).not.toContainEqual(
      expect.objectContaining({ email: 'mira@example.com' }),
    );
  });
});

describe('unlocking an account', () => {
  it('lets an admin open it before the window closes on its own', () => {
    const mira = miraActor();
    failSignIn('mira@example.com', lockout.MAX_FAILED_ATTEMPTS);

    const lock = lockout.unlockAccount(adminActor(), mira.id);

    expect(lock.isLocked).toBe(false);
    expect(lock.failedAttempts).toBe(0);
    expect(() =>
      auth.loginUser({ email: 'mira@example.com', password: DEMO_PASSWORD }),
    ).not.toThrow();
  });

  it('keeps the cleared failures readable rather than deleting them', () => {
    const mira = miraActor();
    failSignIn('mira@example.com', lockout.MAX_FAILED_ATTEMPTS);
    lockout.unlockAccount(adminActor(), mira.id);

    const cleared = getDatabase().signInAttempts.filter(
      (attempt) => attempt.email === 'mira@example.com' && attempt.clearedAt !== null,
    );
    expect(cleared).toHaveLength(lockout.MAX_FAILED_ATTEMPTS);
  });

  it('writes the unlock into the audit log', () => {
    const mira = miraActor();
    failSignIn('mira@example.com', lockout.MAX_FAILED_ATTEMPTS);
    lockout.unlockAccount(adminActor(), mira.id);

    const entry = audit.listAllAuditLogs({ action: 'user.unlocked' })[0];
    expect(entry?.targetId).toBe(mira.id);
    expect(entry?.metadata).toMatchObject({ clearedAttempts: lockout.MAX_FAILED_ATTEMPTS });
  });

  it('refuses anybody who is not a platform admin', () => {
    expect(() => lockout.unlockAccount(danaActor(), miraActor().id)).toThrow(
      'You do not have permission to perform this action',
    );
  });

  it('reports an unknown account as not found', () => {
    expect(() => lockout.unlockAccount(adminActor(), 'does-not-exist')).toThrow('User not found');
  });

  it('reads a lock by account id as well as by address', () => {
    const mira = miraActor();
    failSignIn('mira@example.com', lockout.MAX_FAILED_ATTEMPTS);

    expect(lockout.lockStateForUser(mira.id)?.isLocked).toBe(true);
    expect(lockout.lockStateForUser('does-not-exist')).toBeNull();
  });
});
