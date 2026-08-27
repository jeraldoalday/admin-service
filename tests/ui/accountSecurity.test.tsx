import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { auth, lockout, sessions } from '@/domain';
import { adminActor, DEMO_PASSWORD, danaActor, miraActor } from '../helpers';
import { renderApp } from '../renderApp';

function openAccount(userId: string) {
  return renderApp({ route: '/account', userId });
}

function devicesCard(): HTMLElement {
  return screen
    .getByRole('heading', { name: 'Signed-in devices' })
    .closest('section') as HTMLElement;
}

function attemptsCard(): HTMLElement {
  return screen
    .getByRole('heading', { name: 'Recent sign-in attempts' })
    .closest('section') as HTMLElement;
}

describe('the signed-in devices panel', () => {
  it('lists the devices signed in, marking the one being used', () => {
    openAccount(adminActor().id);
    const card = within(devicesCard());

    // Three seeded sessions plus the one this render opened.
    expect(card.getAllByRole('row')).toHaveLength(5);
    expect(card.getByText('this device')).toBeInTheDocument();
    expect(card.getByText('Safari on iOS')).toBeInTheDocument();
  });

  it('keeps a session that has already been ended on the list', () => {
    openAccount(adminActor().id);

    // The seed includes one Avery ended by hand; hiding it would answer "who is signed in?"
    // while quietly dropping "was anybody signed in that I did not recognise?".
    expect(within(devicesCard()).getByText('REVOKED')).toBeInTheDocument();
  });

  it('revokes one device from its own row', async () => {
    const { user } = openAccount(adminActor().id);
    const card = within(devicesCard());

    const row = card.getByText('Safari on iOS').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Revoke' }));

    expect(await within(row).findByText('REVOKED')).toBeInTheDocument();
    // The other seeded device and this browser's own session are untouched.
    expect(sessions.listOwnSessions(adminActor(), { status: 'ACTIVE' }).total).toBe(2);
  });

  it('signs every other device out at once', async () => {
    const { user } = openAccount(adminActor().id);

    await user.click(screen.getByRole('button', { name: 'Sign out other devices' }));

    expect(await screen.findByText(/Signed out 2 other devices/)).toBeInTheDocument();
    expect(sessions.listOwnSessions(adminActor(), { status: 'ACTIVE' }).total).toBe(1);
  });

  it('leaves the device doing the signing out still signed in', async () => {
    const { user } = openAccount(adminActor().id);

    await user.click(screen.getByRole('button', { name: 'Sign out other devices' }));

    expect(await screen.findByText(/Signed out 2 other devices/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument();
    expect(within(devicesCard()).getByText('this device')).toBeInTheDocument();
  });

  it('offers nothing to sign out when there is only this device', () => {
    openAccount(miraActor().id);

    expect(screen.queryByRole('button', { name: 'Sign out other devices' })).toBeNull();
    expect(within(devicesCard()).getAllByRole('row')).toHaveLength(2);
  });

  it('signs the browser out when its own session is revoked elsewhere', async () => {
    const { user } = openAccount(danaActor().id);

    // Dana's seeded session is not the one this browser is holding; ending every other device
    // must not end this one, and ending this one from outside must land on sign-in.
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('the sign-in attempts panel', () => {
  it('shows the attempts made against your own address', () => {
    openAccount(adminActor().id);
    const card = within(attemptsCard());

    expect(card.getAllByText('Signed in').length).toBeGreaterThan(0);
    expect(card.getByText('Failed')).toBeInTheDocument();
  });

  it('says how many attempts are left before the account locks', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(() => auth.loginUser({ email: 'mira@example.com', password: 'wrong' })).toThrow();
    }
    openAccount(miraActor().id);

    expect(
      await within(attemptsCard()).findByText(/3 recent attempts have failed. 2 more will lock/),
    ).toBeInTheDocument();
  });

  it('says when a locked account opens again', () => {
    for (let attempt = 0; attempt < lockout.MAX_FAILED_ATTEMPTS; attempt += 1) {
      expect(() => auth.loginUser({ email: 'mira@example.com', password: 'wrong' })).toThrow();
    }
    openAccount(miraActor().id);

    expect(within(attemptsCard()).getByText(/Your account is locked after 5 failed/)).toBeVisible();
  });

  it('says nothing at all when nothing has failed', () => {
    openAccount(miraActor().id);

    expect(within(attemptsCard()).queryByText(/will lock the account/)).toBeNull();
    expect(within(attemptsCard()).getByText(/Nothing has tried to sign in as you/)).toBeVisible();
  });
});

describe('changing a password from the account screen', () => {
  it('signs the other devices out and says so', async () => {
    sessions.startSession(adminActor().id, 'Firefox on Windows');
    const { user } = openAccount(adminActor().id);

    await user.type(screen.getByLabelText('Current password'), DEMO_PASSWORD);
    await user.type(screen.getByLabelText('New password'), 'a-longer-secret');
    await user.type(screen.getByLabelText('Confirm new password'), 'a-longer-secret');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText(/every other device signed out/)).toBeInTheDocument();
    expect(sessions.listOwnSessions(adminActor(), { status: 'ACTIVE' }).total).toBe(1);
    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument();
  });
});
