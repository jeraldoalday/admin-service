import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { getDatabase } from '@/domain';
import { renderApp } from '../renderApp';
import { DEMO_PASSWORD } from '../helpers';

describe('signing in', () => {
  it('sends an anonymous visitor to the sign-in screen', () => {
    renderApp({ route: '/users' });

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('signs an admin in and lands them on the overview', async () => {
    const { user } = renderApp();

    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), DEMO_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: /Welcome back, Avery Admin/ })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Audit log' })).toBeInTheDocument();
  });

  it('shows the failure message without revealing whether the account exists', async () => {
    const { user } = renderApp();

    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('refuses a deactivated account', async () => {
    const { user } = renderApp();

    await user.type(screen.getByLabelText('Email'), 'sam@example.com');
    await user.type(screen.getByLabelText('Password'), DEMO_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This account has been deactivated');
  });

  it('registers a new account and signs it in as a platform member', async () => {
    const { user } = renderApp();

    await user.click(screen.getByRole('button', { name: 'Create one' }));
    await user.type(screen.getByLabelText('Display name'), 'Nina Novak');
    await user.type(screen.getByLabelText('Email'), 'nina@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-good-password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: /Welcome back, Nina Novak/ })).toBeVisible();
    // Platform-admin navigation stays hidden for a member.
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
    expect(getDatabase().users).toHaveLength(6);
  });

  it('hides the admin screens from a member who navigates straight to them', () => {
    const dana = getDatabase().users.find((candidate) => candidate.email === 'dana@example.com');
    renderApp({ route: '/audit-logs', userId: dana?.id ?? null });

    expect(screen.getByRole('heading', { name: 'Not available' })).toBeInTheDocument();
  });

  it('signs out back to the sign-in screen', async () => {
    const admin = getDatabase().users.find((candidate) => candidate.email === 'admin@example.com');
    const { user } = renderApp({ userId: admin?.id ?? null });

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
  });
});
