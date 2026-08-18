import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { auth, users, type Actor } from '@/domain';
import { adminActor } from '../helpers';
import { renderApp } from '../renderApp';

/**
 * The users screen shows ten rows per page. Eleven accounts make a second page holding a
 * single row — and because the list runs newest first, that row is the oldest account, so the
 * test acts as a *different* admin to keep it deletable.
 */
function elevenAccountsActingAsANewerAdmin(): Actor {
  const seedAdmin = adminActor();
  let promoted: Actor | null = null;

  for (let index = 0; index < 6; index += 1) {
    const created = auth.registerUser({
      email: `filler${index}@example.com`,
      password: 'a-good-password',
      displayName: `Filler ${index}`,
    });
    if (index === 0) {
      users.updateUser(seedAdmin, created.id, { role: 'ADMIN' });
      promoted = { id: created.id, role: 'ADMIN' };
    }
  }

  if (!promoted) throw new Error('expected to promote an account');
  return promoted;
}

describe('paging through a list that shrinks', () => {
  it('falls back to the last remaining page instead of showing an empty one', async () => {
    const actor = elevenAccountsActingAsANewerAdmin();
    const { user } = renderApp({ route: '/users', userId: actor.id });

    await user.click(screen.getByRole('button', { name: 'Next' }));

    const lonelyRow = within(screen.getByRole('table')).getAllByRole('row')[1] as HTMLElement;
    expect(within(lonelyRow).getByText('admin@example.com')).toBeInTheDocument();

    await user.click(within(lonelyRow).getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));

    // That row was the whole of page two, so page two no longer exists. The screen has to
    // land on a page that does rather than reporting that nothing matches.
    expect(users.listUsers(actor).total).toBe(10);
    expect(screen.queryByText('No accounts match these filters.')).not.toBeInTheDocument();
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(11);
  });
});
