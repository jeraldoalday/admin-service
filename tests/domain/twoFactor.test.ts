import { describe, expect, it } from 'vitest';
import {
  DEMO_RECOVERY_CODES,
  DEMO_TOTP_SECRET,
  audit,
  auth,
  getDatabase,
  totp,
  twoFactor,
  users,
  type Actor,
} from '@/domain';
import { DEMO_PASSWORD, adminActor, danaActor, miraActor, rajActor } from '../helpers';

/** Enrols an account the way the account screen does, and hands back its recovery codes. */
function enrol(actor: Actor): { secret: string; recoveryCodes: string[] } {
  const enrolment = twoFactor.beginTwoFactorEnrolment(actor);
  const { recoveryCodes } = twoFactor.confirmTwoFactorEnrolment(actor, {
    code: totp.currentCode(enrolment.secret),
  });
  return { secret: enrolment.secret, recoveryCodes };
}

describe('starting an enrolment', () => {
  it('hands back a secret, a formatted copy of it, and a URI an app can read', () => {
    const enrolment = twoFactor.beginTwoFactorEnrolment(danaActor());

    expect(enrolment.secret).toMatch(/^[A-Z2-7]+=*$/);
    expect(enrolment.formattedSecret.replace(/ /g, '')).toBe(enrolment.secret.replace(/=+$/, ''));
    expect(enrolment.otpauthUri).toContain('otpauth://totp/');
    expect(new URL(enrolment.otpauthUri).searchParams.get('secret')).toBe(
      enrolment.secret.replace(/=+$/, ''),
    );
  });

  it('does not start being required until a code confirms it', () => {
    const dana = danaActor();
    twoFactor.beginTwoFactorEnrolment(dana);

    expect(twoFactor.getTwoFactor(dana).status).toBe('PENDING');
    expect(twoFactor.isTwoFactorEnabled(dana.id)).toBe(false);

    // The whole point of the pending state: somebody who scanned a code and closed the tab
    // still signs in with a password alone rather than being locked out.
    const result = auth.loginUser({ email: 'dana@example.com', password: DEMO_PASSWORD });
    expect(result.kind).toBe('COMPLETE');
  });

  it('replaces a pending secret rather than handing the old one back', () => {
    const dana = danaActor();
    const first = twoFactor.beginTwoFactorEnrolment(dana);
    const second = twoFactor.beginTwoFactorEnrolment(dana);

    expect(second.secret).not.toBe(first.secret);
    expect(getDatabase().twoFactor.filter((record) => record.userId === dana.id)).toHaveLength(1);
    expect(() =>
      twoFactor.confirmTwoFactorEnrolment(dana, { code: totp.currentCode(first.secret) }),
    ).toThrow('That code is not right');
  });

  it('refuses to start again over a working authenticator', () => {
    expect(() => twoFactor.beginTwoFactorEnrolment(rajActor())).toThrow('already set up');
  });

  it('records that an enrolment began, without recording the secret', () => {
    const dana = danaActor();
    twoFactor.beginTwoFactorEnrolment(dana);

    const entry = audit.listAuditLogs({ action: 'user.two_factor_enrolment_started' }).items.at(0);

    expect(entry?.actorId).toBe(dana.id);
    expect(JSON.stringify(entry)).not.toContain(getDatabase().twoFactor[1]?.secret ?? 'no-secret');
  });
});

describe('confirming an enrolment', () => {
  it('turns it on and mints recovery codes, once', () => {
    const dana = danaActor();
    const enrolment = twoFactor.beginTwoFactorEnrolment(dana);
    const result = twoFactor.confirmTwoFactorEnrolment(dana, {
      code: totp.currentCode(enrolment.secret),
    });

    expect(result.twoFactor.status).toBe('ENABLED');
    expect(result.recoveryCodes).toHaveLength(twoFactor.RECOVERY_CODE_COUNT);
    expect(new Set(result.recoveryCodes).size).toBe(twoFactor.RECOVERY_CODE_COUNT);
    expect(result.twoFactor.remainingRecoveryCodes).toBe(twoFactor.RECOVERY_CODE_COUNT);
  });

  it('never stores a recovery code in a form it could be read back from', () => {
    const { recoveryCodes } = enrol(danaActor());
    const stored = JSON.stringify(getDatabase().recoveryCodes);

    recoveryCodes.forEach((code) => expect(stored).not.toContain(code));
  });

  it('refuses a wrong code and stays pending', () => {
    const dana = danaActor();
    twoFactor.beginTwoFactorEnrolment(dana);

    expect(() => twoFactor.confirmTwoFactorEnrolment(dana, { code: '000000' })).toThrow(
      'That code is not right',
    );
    expect(twoFactor.getTwoFactor(dana).status).toBe('PENDING');
  });

  it('refuses when no enrolment was started', () => {
    expect(() => twoFactor.confirmTwoFactorEnrolment(danaActor(), { code: '123456' })).toThrow(
      'Start setting up two-factor authentication first',
    );
  });

  it('spends the confirming code, so a shoulder-surfer cannot reuse it', () => {
    const dana = danaActor();
    const enrolment = twoFactor.beginTwoFactorEnrolment(dana);
    const code = totp.currentCode(enrolment.secret);
    twoFactor.confirmTwoFactorEnrolment(dana, { code });

    expect(twoFactor.consumeTwoFactorCode(dana.id, code)).toBeNull();
  });
});

describe('spending a code', () => {
  it('accepts a code from the authenticator and refuses the same one twice', () => {
    const raj = rajActor();
    const code = totp.currentCode(DEMO_TOTP_SECRET);

    expect(twoFactor.consumeTwoFactorCode(raj.id, code)).toBe('TOTP');
    expect(twoFactor.consumeTwoFactorCode(raj.id, code)).toBeNull();
  });

  it('refuses a code from a step at or behind the floor, even a valid one', () => {
    const raj = rajActor();
    const now = Date.now();
    const step = totp.timeStepAt(now);
    const spend = (offset: number): string | null =>
      twoFactor.consumeTwoFactorCode(
        raj.id,
        totp.codeForStep(DEMO_TOTP_SECRET, step + offset),
        now,
      );

    expect(spend(0)).toBe('TOTP');
    // Still inside the drift window, so still mathematically valid — and refused anyway,
    // because it names a step this authenticator has already been past.
    expect(spend(-1)).toBeNull();
    // The window ahead is past the floor, so it works.
    expect(spend(1)).toBe('TOTP');
  });

  it('falls back to a recovery code and stamps it used', () => {
    const raj = rajActor();
    const code = DEMO_RECOVERY_CODES[1] as string;

    expect(twoFactor.consumeTwoFactorCode(raj.id, code)).toBe('RECOVERY_CODE');
    expect(twoFactor.consumeTwoFactorCode(raj.id, code)).toBeNull();
    expect(twoFactor.getTwoFactor(raj).remainingRecoveryCodes).toBe(DEMO_RECOVERY_CODES.length - 2);
  });

  it('accepts a recovery code however it was transcribed', () => {
    const raj = rajActor();
    const code = DEMO_RECOVERY_CODES[2] as string;

    expect(twoFactor.consumeTwoFactorCode(raj.id, code.replace('-', '').toLowerCase())).toBe(
      'RECOVERY_CODE',
    );
  });

  it('refuses a recovery code that was already spent in the seed', () => {
    expect(twoFactor.consumeTwoFactorCode(rajActor().id, DEMO_RECOVERY_CODES[0] as string)).toBe(
      null,
    );
  });

  it('records a spent recovery code, since it means a phone has gone missing', () => {
    twoFactor.consumeTwoFactorCode(rajActor().id, DEMO_RECOVERY_CODES[3] as string);

    const entry = audit.listAuditLogs({ action: 'user.two_factor_recovery_code_used' }).items.at(0);

    expect(entry?.targetId).toBe(rajActor().id);
    expect(entry?.metadata).toMatchObject({ remaining: DEMO_RECOVERY_CODES.length - 2 });
  });

  it('refuses everything for an account with no confirmed authenticator', () => {
    const dana = danaActor();
    expect(twoFactor.consumeTwoFactorCode(dana.id, '123456')).toBeNull();

    twoFactor.beginTwoFactorEnrolment(dana);
    const pending = getDatabase().twoFactor.find((record) => record.userId === dana.id);
    expect(twoFactor.consumeTwoFactorCode(dana.id, totp.currentCode(pending?.secret ?? ''))).toBe(
      null,
    );
  });

  it("does not accept one account's recovery code against another", () => {
    expect(twoFactor.consumeTwoFactorCode(miraActor().id, DEMO_RECOVERY_CODES[4] as string)).toBe(
      null,
    );
  });
});

describe('regenerating recovery codes', () => {
  it('replaces the whole set, and the old ones stop working', () => {
    const raj = rajActor();
    const result = twoFactor.regenerateRecoveryCodes(raj, { password: DEMO_PASSWORD });

    expect(result.recoveryCodes).toHaveLength(twoFactor.RECOVERY_CODE_COUNT);
    expect(result.twoFactor.remainingRecoveryCodes).toBe(twoFactor.RECOVERY_CODE_COUNT);
    expect(twoFactor.consumeTwoFactorCode(raj.id, DEMO_RECOVERY_CODES[5] as string)).toBeNull();
    expect(twoFactor.consumeTwoFactorCode(raj.id, result.recoveryCodes[0] as string)).toBe(
      'RECOVERY_CODE',
    );
  });

  it('costs a password', () => {
    expect(() => twoFactor.regenerateRecoveryCodes(rajActor(), { password: 'wrong' })).toThrow(
      'Your password is incorrect',
    );
  });

  it('refuses when there is no authenticator to have codes for', () => {
    expect(() =>
      twoFactor.regenerateRecoveryCodes(danaActor(), { password: DEMO_PASSWORD }),
    ).toThrow('not set up');
  });
});

describe('turning it off', () => {
  it('takes the recovery codes with it', () => {
    const raj = rajActor();
    expect(twoFactor.disableTwoFactor(raj, { password: DEMO_PASSWORD }).status).toBe('DISABLED');

    expect(getDatabase().recoveryCodes.filter((code) => code.userId === raj.id)).toHaveLength(0);
    expect(twoFactor.consumeTwoFactorCode(raj.id, DEMO_RECOVERY_CODES[6] as string)).toBeNull();
    expect(auth.loginUser({ email: 'raj@example.com', password: DEMO_PASSWORD }).kind).toBe(
      'COMPLETE',
    );
  });

  it('costs a password, so an open session is not enough on its own', () => {
    expect(() => twoFactor.disableTwoFactor(rajActor(), { password: 'wrong' })).toThrow(
      'Your password is incorrect',
    );
    expect(twoFactor.isTwoFactorEnabled(rajActor().id)).toBe(true);
  });

  it('clears a half-finished enrolment too, and says which it was', () => {
    const dana = danaActor();
    twoFactor.beginTwoFactorEnrolment(dana);
    twoFactor.disableTwoFactor(dana, { password: DEMO_PASSWORD });

    const entry = audit.listAuditLogs({ action: 'user.two_factor_disabled' }).items.at(0);

    expect(entry?.metadata).toMatchObject({ previousStatus: 'PENDING' });
  });

  it('refuses when there is nothing to turn off', () => {
    expect(() => twoFactor.disableTwoFactor(danaActor(), { password: DEMO_PASSWORD })).toThrow(
      'not set up',
    );
  });
});

describe('an administrator clearing one', () => {
  it('removes it and names who did', () => {
    const admin = adminActor();
    const raj = rajActor();

    expect(twoFactor.disableTwoFactorForUser(admin, raj.id).status).toBe('DISABLED');

    const entry = audit.listAuditLogs({ action: 'user.two_factor_reset' }).items.at(0);
    expect(entry?.actorId).toBe(admin.id);
    expect(entry?.metadata).toMatchObject({ email: 'raj@example.com', previousStatus: 'ENABLED' });
  });

  it('is admin-only', () => {
    expect(() => twoFactor.disableTwoFactorForUser(danaActor(), rajActor().id)).toThrow(
      'You do not have permission to perform this action',
    );
  });

  it('refuses an account nobody holds, and one with nothing set up', () => {
    const admin = adminActor();
    expect(() => twoFactor.disableTwoFactorForUser(admin, 'nobody')).toThrow('User not found');
    expect(() => twoFactor.disableTwoFactorForUser(admin, danaActor().id)).toThrow('not set up');
  });
});

describe('the admin user list', () => {
  it('says which accounts have a confirmed authenticator', () => {
    const admin = adminActor();
    const listed = users.listUsers(admin, { hasTwoFactor: true });

    expect(listed.items.map((user) => user.email)).toEqual(['raj@example.com']);
    expect(users.listUsers(admin, { hasTwoFactor: false }).total).toBe(4);
  });

  it('counts a half-finished enrolment as not having one', () => {
    twoFactor.beginTwoFactorEnrolment(danaActor());

    expect(users.listUsers(adminActor(), { hasTwoFactor: true }).total).toBe(1);
  });

  it('takes the authenticator with the account when it is deleted', () => {
    const raj = rajActor();
    users.deleteUser(adminActor(), raj.id);

    expect(getDatabase().twoFactor.filter((record) => record.userId === raj.id)).toHaveLength(0);
    expect(getDatabase().recoveryCodes.filter((code) => code.userId === raj.id)).toHaveLength(0);
  });
});

describe('reading your own state', () => {
  it('never carries the secret', () => {
    expect(JSON.stringify(twoFactor.getTwoFactor(rajActor()))).not.toContain(DEMO_TOTP_SECRET);
  });

  it('needs a session', () => {
    expect(() => twoFactor.getTwoFactor(null as unknown as Actor)).toThrow('Unauthorized');
  });

  it('refuses a session pointing at an account that is no longer active', () => {
    const dana = danaActor();
    users.updateUser(adminActor(), dana.id, { isActive: false });

    expect(() => twoFactor.beginTwoFactorEnrolment(dana)).toThrow(
      'This session is no longer valid',
    );
  });
});
