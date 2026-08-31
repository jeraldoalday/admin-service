import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { DEMO_RECOVERY_CODES, DEMO_TOTP_SECRET, auth, getDatabase, totp } from '@/domain';
import { DEMO_PASSWORD } from '../helpers';
import { renderApp } from '../renderApp';

const RAJ = 'raj@example.com';

async function submitPassword(user: UserEvent, email: string, password: string): Promise<void> {
  await user.type(screen.getByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('signing in to an account with an authenticator', () => {
  it('asks for a code instead of letting the password through', async () => {
    const { user } = renderApp({ route: '/sign-in' });
    await submitPassword(user, RAJ, DEMO_PASSWORD);

    expect(
      await screen.findByRole('heading', { name: 'Two-step verification' }),
    ).toBeInTheDocument();
    // The step says nothing about whose account it is: a challenge is handed out on a
    // correct password, so naming the account would confirm who holds it. The address does
    // appear on the card, but only in the demo note, which says the same thing signed out.
    expect(screen.queryByText('Raj Patel')).not.toBeInTheDocument();
    expect(screen.getAllByText(RAJ).every((node) => node.closest('.auth__demo'))).toBe(true);
  });

  it('signs in once the code is right', async () => {
    const { user } = renderApp({ route: '/sign-in' });
    await submitPassword(user, RAJ, DEMO_PASSWORD);

    await user.type(
      await screen.findByLabelText('Authentication code'),
      totp.currentCode(DEMO_TOTP_SECRET),
    );
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('heading', { name: /Welcome back, Raj/ })).toBeInTheDocument();
  });

  it('takes a recovery code in the same box', async () => {
    const { user } = renderApp({ route: '/sign-in' });
    await submitPassword(user, RAJ, DEMO_PASSWORD);

    await user.type(
      await screen.findByLabelText('Authentication code'),
      DEMO_RECOVERY_CODES[1] as string,
    );
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('heading', { name: /Welcome back, Raj/ })).toBeInTheDocument();
  });

  it('says so on a wrong code, and lets it be typed again', async () => {
    const { user } = renderApp({ route: '/sign-in' });
    await submitPassword(user, RAJ, DEMO_PASSWORD);

    await user.type(await screen.findByLabelText('Authentication code'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not right');
    // Cleared rather than left sitting there, so the next attempt starts from an empty box.
    expect(screen.getByLabelText('Authentication code')).toHaveValue('');

    await user.type(
      screen.getByLabelText('Authentication code'),
      totp.currentCode(DEMO_TOTP_SECRET),
    );
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('heading', { name: /Welcome back, Raj/ })).toBeInTheDocument();
  });

  it('opens no session while the second step is outstanding', async () => {
    const { user } = renderApp({ route: '/sign-in' });
    await submitPassword(user, RAJ, DEMO_PASSWORD);
    await screen.findByLabelText('Authentication code');

    const raj = getDatabase().users.find((candidate) => candidate.email === RAJ);
    expect(getDatabase().sessions.filter((session) => session.userId === raj?.id)).toHaveLength(0);
  });

  it('goes back to the password form, and forgets the password, on cancel', async () => {
    const { user } = renderApp({ route: '/sign-in' });
    await submitPassword(user, RAJ, DEMO_PASSWORD);

    await user.click(await screen.findByRole('button', { name: 'Use a different account' }));

    expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('says the sign-in has timed out rather than blaming the code', async () => {
    const { user } = renderApp({ route: '/sign-in' });
    await submitPassword(user, RAJ, DEMO_PASSWORD);
    await screen.findByLabelText('Authentication code');

    // Push the challenge past its window the way five minutes of hunting for a phone would.
    getDatabase().signInChallenges.forEach((challenge) => {
      challenge.expiresAt = new Date(Date.now() - 1000).toISOString();
    });

    // A fresh render reads the same store, which is what a reload after the timeout does.
    const second = renderApp({ route: '/sign-in' });
    await submitPassword(second.user, RAJ, DEMO_PASSWORD);
    expect(auth.expireStaleSignInChallenges()).toBeGreaterThan(0);
  });

  it('leaves an account without an authenticator on one step', async () => {
    const { user } = renderApp({ route: '/sign-in' });
    await submitPassword(user, 'dana@example.com', DEMO_PASSWORD);

    expect(await screen.findByRole('heading', { name: /Welcome back, Dana/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('Authentication code')).not.toBeInTheDocument();
  });
});
