import { describe, expect, it } from 'vitest';
import {
  DEMO_RECOVERY_CODES,
  DEMO_TOTP_SECRET,
  audit,
  auth,
  getDatabase,
  lockout,
  totp,
  twoFactor,
  users,
} from '@/domain';
import { DEMO_PASSWORD, adminActor, rajActor } from '../helpers';

const RAJ = 'raj@example.com';

/** The password half of a sign-in against the seeded account that has an authenticator. */
function challenge(): { challengeId: string; expiresAt: string } {
  const result = auth.loginUser({ email: RAJ, password: DEMO_PASSWORD });
  if (result.kind !== 'TWO_FACTOR_REQUIRED') {
    throw new Error('Expected the seeded account to ask for a second factor');
  }
  return result;
}

describe('the password step', () => {
  it('returns a challenge rather than an account', () => {
    const result = challenge();

    expect(result.challengeId).toMatch(/^[0-9a-f]{36}$/);
    expect(Date.parse(result.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('opens nothing on its own', () => {
    challenge();
    expect(
      getDatabase().sessions.filter((session) => session.userId === rajActor().id),
    ).toHaveLength(0);
  });

  it('records no attempt yet, since knowing the password is not signing in', () => {
    const before = getDatabase().signInAttempts.length;
    challenge();

    expect(getDatabase().signInAttempts).toHaveLength(before);
  });

  it('still refuses a wrong password before it ever gets that far', () => {
    expect(() => auth.loginUser({ email: RAJ, password: 'wrong' })).toThrow(
      'Invalid email or password',
    );
    expect(getDatabase().signInChallenges).toHaveLength(0);
  });

  it('does not ask an account without an authenticator', () => {
    expect(auth.loginUser({ email: 'dana@example.com', password: DEMO_PASSWORD }).kind).toBe(
      'COMPLETE',
    );
  });
});

describe('the code step', () => {
  it('finishes the sign-in with a code from the authenticator', () => {
    const { challengeId } = challenge();
    const user = auth.completeTwoFactorSignIn({
      challengeId,
      code: totp.currentCode(DEMO_TOTP_SECRET),
    });

    expect(user.email).toBe(RAJ);
    expect(lockout.lockStateFor(RAJ).failedAttempts).toBe(0);
  });

  it('finishes it with a recovery code too', () => {
    const { challengeId } = challenge();

    expect(
      auth.completeTwoFactorSignIn({ challengeId, code: DEMO_RECOVERY_CODES[1] as string }).email,
    ).toBe(RAJ);
  });

  it('spends the challenge, so it cannot be answered twice', () => {
    const { challengeId } = challenge();
    const code = totp.currentCode(DEMO_TOTP_SECRET);
    auth.completeTwoFactorSignIn({ challengeId, code });

    expect(() => auth.completeTwoFactorSignIn({ challengeId, code })).toThrow(
      'That sign-in has expired',
    );
  });

  it('leaves the challenge open after a wrong code, so a typo is not fatal', () => {
    const { challengeId } = challenge();

    expect(() => auth.completeTwoFactorSignIn({ challengeId, code: '000000' })).toThrow(
      'That code is not right',
    );
    expect(
      auth.completeTwoFactorSignIn({ challengeId, code: totp.currentCode(DEMO_TOTP_SECRET) }).email,
    ).toBe(RAJ);
  });

  it('counts a wrong code towards the same lockout a wrong password would', () => {
    const before = lockout.lockStateFor(RAJ).failedAttempts;

    for (let attempt = 0; attempt < lockout.MAX_FAILED_ATTEMPTS - before; attempt += 1) {
      const { challengeId } = challenge();
      expect(() => auth.completeTwoFactorSignIn({ challengeId, code: '000000' })).toThrow();
    }

    expect(lockout.lockStateFor(RAJ).isLocked).toBe(true);
    expect(() => auth.loginUser({ email: RAJ, password: DEMO_PASSWORD })).toThrow(
      'Too many failed sign-in attempts',
    );
  });

  it('refuses a challenge id nobody issued', () => {
    expect(() => auth.completeTwoFactorSignIn({ challengeId: 'made-up', code: '000000' })).toThrow(
      'That sign-in has expired',
    );
  });

  it('refuses one that has run out of time', () => {
    const { challengeId } = challenge();
    const stored = getDatabase().signInChallenges.find((record) => record.id === challengeId);
    if (stored) stored.expiresAt = new Date(Date.now() - 1000).toISOString();

    expect(() =>
      auth.completeTwoFactorSignIn({ challengeId, code: totp.currentCode(DEMO_TOTP_SECRET) }),
    ).toThrow('That sign-in has expired');
  });

  it('re-reads the account, so a deactivation between the steps still lands', () => {
    const { challengeId } = challenge();
    users.updateUser(adminActor(), rajActor().id, { isActive: false });

    expect(() =>
      auth.completeTwoFactorSignIn({ challengeId, code: totp.currentCode(DEMO_TOTP_SECRET) }),
    ).toThrow('This account has been deactivated');
  });

  it('refuses once an administrator has cleared the authenticator mid-sign-in', () => {
    const { challengeId } = challenge();
    twoFactor.disableTwoFactorForUser(adminActor(), rajActor().id);

    expect(() =>
      auth.completeTwoFactorSignIn({ challengeId, code: totp.currentCode(DEMO_TOTP_SECRET) }),
    ).toThrow('That code is not right');
  });
});

describe('a password change', () => {
  it('closes an outstanding challenge the old password opened', () => {
    const { challengeId } = challenge();

    auth.changePassword(rajActor(), {
      currentPassword: DEMO_PASSWORD,
      newPassword: 'a-longer-secret',
      confirmPassword: 'a-longer-secret',
    });

    expect(() =>
      auth.completeTwoFactorSignIn({ challengeId, code: totp.currentCode(DEMO_TOTP_SECRET) }),
    ).toThrow('That sign-in has expired');
  });

  it('says in the audit trail how many it closed', () => {
    challenge();
    challenge();
    auth.changePassword(rajActor(), {
      currentPassword: DEMO_PASSWORD,
      newPassword: 'a-longer-secret',
      confirmPassword: 'a-longer-secret',
    });

    expect(
      audit.listAuditLogs({ action: 'user.password_changed' }).items.at(0)?.metadata,
    ).toMatchObject({ discardedChallenges: 2 });
  });

  it('says nothing at all when there was nothing outstanding', () => {
    // Raj has no open sessions in the seed either, so the entry carries no metadata rather
    // than a pair of zeroes describing two things that did not happen.
    auth.changePassword(rajActor(), {
      currentPassword: DEMO_PASSWORD,
      newPassword: 'a-longer-secret',
      confirmPassword: 'a-longer-secret',
    });

    expect(
      audit.listAuditLogs({ action: 'user.password_changed' }).items.at(0)?.metadata,
    ).toBeNull();
  });
});

describe('sweeping up challenges', () => {
  it('drops the ones that lapsed and the ones already answered', () => {
    const answered = challenge();
    auth.completeTwoFactorSignIn({
      challengeId: answered.challengeId,
      code: totp.currentCode(DEMO_TOTP_SECRET),
    });

    const abandoned = challenge();
    const stored = getDatabase().signInChallenges.find(
      (record) => record.id === abandoned.challengeId,
    );
    if (stored) stored.expiresAt = new Date(Date.now() - 1000).toISOString();

    expect(auth.expireStaleSignInChallenges()).toBe(2);
    expect(getDatabase().signInChallenges).toHaveLength(0);
  });

  it('leaves a live one alone, and reports nothing to do', () => {
    challenge();

    expect(auth.expireStaleSignInChallenges()).toBe(0);
    expect(getDatabase().signInChallenges).toHaveLength(1);
  });
});
