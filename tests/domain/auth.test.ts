import { describe, expect, it } from 'vitest';
import { AppError, auth, emptyDatabase, getDatabase, replaceDatabase, users } from '@/domain';
import { DEMO_PASSWORD, adminActor } from '../helpers';

describe('registration', () => {
  it('creates an account and returns it without the password hash', () => {
    const user = auth.registerUser({
      email: 'New.Person@Example.com ',
      password: 'a-good-password',
      displayName: 'New Person',
    });

    expect(user.email).toBe('new.person@example.com');
    expect(user).not.toHaveProperty('passwordHash');
    expect(user.role).toBe('MEMBER');
  });

  it('rejects a duplicate email with a conflict', () => {
    expect(() =>
      auth.registerUser({
        email: 'admin@example.com',
        password: 'a-good-password',
        displayName: 'Impostor',
      }),
    ).toThrow('An account with this email already exists');
  });

  it('rejects a password shorter than eight characters', () => {
    try {
      auth.registerUser({ email: 'short@example.com', password: 'abc', displayName: 'Short' });
      expect.unreachable('registration should have been rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).statusCode).toBe(400);
    }
  });

  it('makes the very first account an admin so the console is reachable', () => {
    replaceDatabase(emptyDatabase());

    const first = auth.registerUser({
      email: 'first@example.com',
      password: 'a-good-password',
      displayName: 'First',
    });
    const second = auth.registerUser({
      email: 'second@example.com',
      password: 'a-good-password',
      displayName: 'Second',
    });

    expect(first.role).toBe('ADMIN');
    expect(second.role).toBe('MEMBER');
  });

  it('stores a hash rather than the password itself', () => {
    auth.registerUser({
      email: 'hashed@example.com',
      password: 'a-good-password',
      displayName: 'Hashed',
    });

    const stored = getDatabase().users.find((user) => user.email === 'hashed@example.com');
    expect(stored?.passwordHash).toBeDefined();
    expect(stored?.passwordHash).not.toContain('a-good-password');
  });
});

describe('sign in', () => {
  it('accepts the right password', () => {
    const user = auth.loginUser({ email: 'admin@example.com', password: DEMO_PASSWORD });
    expect(user.role).toBe('ADMIN');
  });

  it('gives the same error for a wrong password and an unknown account', () => {
    const wrongPassword = (): unknown =>
      auth.loginUser({ email: 'admin@example.com', password: 'nope' });
    const unknownAccount = (): unknown =>
      auth.loginUser({ email: 'nobody@example.com', password: DEMO_PASSWORD });

    expect(wrongPassword).toThrow('Invalid email or password');
    expect(unknownAccount).toThrow('Invalid email or password');
  });

  it('refuses a deactivated account', () => {
    expect(() => auth.loginUser({ email: 'sam@example.com', password: DEMO_PASSWORD })).toThrow(
      'This account has been deactivated',
    );
  });
});

describe('session resumption', () => {
  it('drops a session whose account was deactivated', () => {
    const admin = adminActor();
    const dana = getDatabase().users.find((user) => user.email === 'dana@example.com');

    expect(auth.resumeSession(dana?.id ?? '')).not.toBeNull();
    users.updateUser(admin, dana?.id ?? '', { isActive: false });
    expect(auth.resumeSession(dana?.id ?? '')).toBeNull();
  });

  it('drops a session whose account no longer exists', () => {
    expect(auth.resumeSession('does-not-exist')).toBeNull();
  });
});
