import { describe, expect, it } from 'vitest';
import { audit, auth, getDatabase, users } from '@/domain';
import { adminActor, danaActor, DEMO_PASSWORD, signInFully } from '../helpers';

describe('updating your own profile', () => {
  it('renames the account and records who did it', () => {
    const dana = danaActor();

    const updated = auth.updateProfile(dana, { displayName: 'Dana D.' });

    expect(updated.displayName).toBe('Dana D.');
    expect(auth.findUserById(dana.id)?.displayName).toBe('Dana D.');
    expect(audit.listAuditLogs({ action: 'user.profile_updated' }).items[0]).toMatchObject({
      actorId: dana.id,
      targetId: dana.id,
      metadata: { displayName: 'Dana D.' },
    });
  });

  it('trims the name and refuses an empty one', () => {
    const dana = danaActor();

    expect(auth.updateProfile(dana, { displayName: '  Dana Diaz  ' }).displayName).toBe(
      'Dana Diaz',
    );
    expect(() => auth.updateProfile(dana, { displayName: '   ' })).toThrow(
      'Display name is required',
    );
  });

  it('leaves the platform role alone — that stays somebody else’s decision', () => {
    const dana = danaActor();

    auth.updateProfile(dana, { displayName: 'Dana D.' });

    expect(auth.findUserById(dana.id)?.role).toBe('MEMBER');
  });

  it('refuses a session whose account has since been deactivated', () => {
    const admin = adminActor();
    const dana = danaActor();
    users.updateUser(admin, dana.id, { isActive: false });

    expect(() => auth.updateProfile(dana, { displayName: 'Nope' })).toThrow(
      'This session is no longer valid',
    );
  });
});

describe('changing your own password', () => {
  const change = {
    currentPassword: DEMO_PASSWORD,
    newPassword: 'a-longer-secret',
    confirmPassword: 'a-longer-secret',
  };

  it('replaces the password and leaves the old one dead', () => {
    const dana = danaActor();

    auth.changePassword(dana, change);

    expect(signInFully('dana@example.com', 'a-longer-secret').id).toBe(dana.id);
    expect(() => auth.loginUser({ email: 'dana@example.com', password: DEMO_PASSWORD })).toThrow(
      'Invalid email or password',
    );
  });

  it('requires the current password, so an open session is not enough', () => {
    const dana = danaActor();

    expect(() =>
      auth.changePassword(dana, { ...change, currentPassword: 'not-the-password' }),
    ).toThrow('Your current password is incorrect');
    expect(signInFully('dana@example.com').id).toBe(dana.id);
  });

  it('refuses a confirmation that does not match', () => {
    expect(() =>
      auth.changePassword(danaActor(), { ...change, confirmPassword: 'something-else' }),
    ).toThrow('The new passwords do not match');
  });

  it('refuses a password shorter than eight characters', () => {
    expect(() =>
      auth.changePassword(danaActor(), {
        currentPassword: DEMO_PASSWORD,
        newPassword: 'short',
        confirmPassword: 'short',
      }),
    ).toThrow('Password must be at least 8 characters');
  });

  it('refuses reusing the current password', () => {
    expect(() =>
      auth.changePassword(danaActor(), {
        currentPassword: DEMO_PASSWORD,
        newPassword: DEMO_PASSWORD,
        confirmPassword: DEMO_PASSWORD,
      }),
    ).toThrow('The new password must be different from the current one');
  });

  it('records that it happened and nothing about either password', () => {
    const dana = danaActor();

    auth.changePassword(dana, change);

    const entry = audit.listAuditLogs({ action: 'user.password_changed' }).items[0];
    expect(entry).toMatchObject({ actorId: dana.id, targetType: 'user', targetId: dana.id });
    expect(JSON.stringify(entry)).not.toContain('a-longer-secret');
    expect(JSON.stringify(entry)).not.toContain(DEMO_PASSWORD);
  });

  it('never stores the password itself', () => {
    const dana = danaActor();

    auth.changePassword(dana, change);

    const stored = getDatabase().users.find((user) => user.id === dana.id);
    expect(stored?.passwordHash).not.toContain('a-longer-secret');
    expect(stored?.passwordHash.startsWith('$2')).toBe(true);
  });
});
