import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { getDatabase, teams, users } from '@/domain';
import { adminActor } from '../helpers';
import { renderApp } from '../renderApp';

describe('resetting the demo data', () => {
  it('asks before discarding anything', async () => {
    const admin = adminActor();
    teams.createTeam(admin, { name: 'Experiment' });

    const { user } = renderApp({ userId: admin.id });
    await user.click(screen.getByRole('button', { name: 'Reset demo data' }));

    expect(
      screen.getByText('This discards everything in this browser and signs you out.'),
    ).toBeInTheDocument();
    expect(getDatabase().teams).toHaveLength(3);
  });

  it('restores the seeded dataset and signs you out', async () => {
    const admin = adminActor();
    teams.createTeam(admin, { name: 'Experiment' });
    users.deleteUser(admin, users.listUsers(admin).items[0]?.id ?? '');

    const { user } = renderApp({ userId: admin.id });
    await user.click(screen.getByRole('button', { name: 'Reset demo data' }));
    await user.click(screen.getByRole('button', { name: 'Confirm reset' }));

    // The old session pointed at an account the reseeded tables no longer contain, so being
    // returned to sign-in is part of the reset rather than an afterthought.
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(getDatabase().teams.map((team) => team.slug)).toEqual(['platform', 'growth']);
    expect(getDatabase().users).toHaveLength(5);
  });

  it('backs out without touching anything', async () => {
    const admin = adminActor();
    teams.createTeam(admin, { name: 'Experiment' });

    const { user } = renderApp({ userId: admin.id });
    await user.click(screen.getByRole('button', { name: 'Reset demo data' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('button', { name: 'Reset demo data' })).toBeInTheDocument();
    expect(getDatabase().teams).toHaveLength(3);
  });
});
