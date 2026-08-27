import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { getDatabase, lockout } from '@/domain';
import { DEMO_PASSWORD, adminActor } from '../helpers';
import { renderApp } from '../renderApp';

type Driver = ReturnType<typeof renderApp>['user'];

async function attemptSignIn(user: Driver, email: string, password: string): Promise<void> {
  const emailField = screen.getByLabelText('Email');
  const passwordField = screen.getByLabelText('Password');

  await user.clear(emailField);
  await user.type(emailField, email);
  await user.clear(passwordField);
  await user.type(passwordField, password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('the sign-in form under a lockout', () => {
  it('counts down the attempts left after a failure', async () => {
    const { user } = renderApp();

    await attemptSignIn(user, 'mira@example.com', 'wrong-password');

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(screen.getByRole('status')).toHaveTextContent('4 more failed attempts will lock');
  });

  it('shifts to the singular on the last attempt', async () => {
    const { user } = renderApp();

    for (let attempt = 0; attempt < lockout.MAX_FAILED_ATTEMPTS - 1; attempt += 1) {
      await attemptSignIn(user, 'mira@example.com', 'wrong-password');
    }

    expect(screen.getByRole('status')).toHaveTextContent('1 more failed attempt will lock');
  });

  it('refuses the right password once the address is locked, and says why', async () => {
    const { user } = renderApp();

    for (let attempt = 0; attempt < lockout.MAX_FAILED_ATTEMPTS; attempt += 1) {
      await attemptSignIn(user, 'mira@example.com', 'wrong-password');
    }
    await attemptSignIn(user, 'mira@example.com', DEMO_PASSWORD);

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many failed sign-in attempts');
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('drops the countdown once the address is shut', async () => {
    const { user } = renderApp();

    for (let attempt = 0; attempt < lockout.MAX_FAILED_ATTEMPTS; attempt += 1) {
      await attemptSignIn(user, 'mira@example.com', 'wrong-password');
    }

    // There is nothing left to count down to, and repeating the number would read as though
    // the next attempt might still get through.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('locks an address no account holds, giving nothing away', async () => {
    const { user } = renderApp();

    for (let attempt = 0; attempt < lockout.MAX_FAILED_ATTEMPTS; attempt += 1) {
      await attemptSignIn(user, 'nobody@example.com', 'wrong-password');
    }

    expect(lockout.lockStateFor('nobody@example.com').isLocked).toBe(true);
    await attemptSignIn(user, 'nobody@example.com', 'wrong-password');
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many failed sign-in attempts');
  });

  it('lets the account back in once an admin unlocks it', async () => {
    const { user, unmount } = renderApp();

    for (let attempt = 0; attempt < lockout.MAX_FAILED_ATTEMPTS; attempt += 1) {
      await attemptSignIn(user, 'mira@example.com', 'wrong-password');
    }
    const mira = getDatabase().users.find((candidate) => candidate.email === 'mira@example.com');
    lockout.unlockAccount(adminActor(), mira?.id ?? '');
    unmount();

    const second = renderApp();
    await attemptSignIn(second.user, 'mira@example.com', DEMO_PASSWORD);

    expect(await screen.findByRole('heading', { name: /Welcome back, Mira Okafor/ })).toBeVisible();
  });
});

describe('a locked account on the users screen', () => {
  function lockMira(): string {
    const mira = getDatabase().users.find((candidate) => candidate.email === 'mira@example.com');
    for (let attempt = 0; attempt < lockout.MAX_FAILED_ATTEMPTS; attempt += 1) {
      lockout.recordSignInAttempt({
        email: 'mira@example.com',
        userId: mira?.id ?? null,
        outcome: 'FAILED',
      });
    }
    return mira?.id ?? '';
  }

  function openUsers() {
    return renderApp({ route: '/users', userId: adminActor().id });
  }

  function rowFor(name: string): HTMLElement {
    return screen.getByText(name).closest('tr') as HTMLElement;
  }

  it('flags the locked row and offers to open it', () => {
    lockMira();
    openUsers();

    const row = within(rowFor('Mira Okafor'));
    expect(row.getByText('Locked')).toBeInTheDocument();
    expect(row.getByRole('button', { name: 'Unlock' })).toBeInTheDocument();
  });

  it('leaves an unlocked row alone', () => {
    lockMira();
    openUsers();

    expect(within(rowFor('Dana Diaz')).queryByRole('button', { name: 'Unlock' })).toBeNull();
  });

  it('unlocks the account from its row', async () => {
    lockMira();
    const { user } = openUsers();

    await user.click(within(rowFor('Mira Okafor')).getByRole('button', { name: 'Unlock' }));

    expect(within(rowFor('Mira Okafor')).queryByText('Locked')).toBeNull();
    expect(lockout.lockStateFor('mira@example.com').isLocked).toBe(false);
  });

  it('narrows the list to the accounts that cannot sign in', async () => {
    lockMira();
    const { user } = openUsers();

    await user.selectOptions(screen.getByLabelText('Sign-in'), 'true');

    expect(screen.getByText('Mira Okafor')).toBeInTheDocument();
    expect(screen.queryByText('Dana Diaz')).toBeNull();
  });

  it('narrows it the other way just as well', async () => {
    lockMira();
    const { user } = openUsers();

    await user.selectOptions(screen.getByLabelText('Sign-in'), 'false');

    expect(screen.queryByText('Mira Okafor')).toBeNull();
    expect(screen.getByText('Dana Diaz')).toBeInTheDocument();
  });
});
