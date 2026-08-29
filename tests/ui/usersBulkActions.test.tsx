import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { getDatabase, lockout } from '@/domain';
import { adminActor } from '../helpers';
import { renderApp } from '../renderApp';

function renderAsAdmin() {
  return renderApp({ route: '/users', userId: adminActor().id });
}

function table() {
  return within(screen.getByRole('table'));
}

/** The selection bar, which only exists once something is ticked. */
function bar() {
  return within(screen.getByRole('group', { name: 'Bulk actions' }));
}

function isActive(email: string): boolean {
  return getDatabase().users.find((user) => user.email === email)?.isActive ?? false;
}

describe('selecting accounts', () => {
  it('shows nothing until something is ticked', () => {
    renderAsAdmin();

    expect(screen.queryByRole('group', { name: 'Bulk actions' })).not.toBeInTheDocument();
  });

  it('counts what is selected', async () => {
    const { user } = renderAsAdmin();

    await user.click(table().getByLabelText('Select Dana Diaz'));
    expect(bar().getByText('1 account selected')).toBeInTheDocument();

    await user.click(table().getByLabelText('Select Raj Patel'));
    expect(bar().getByText('2 accounts selected')).toBeInTheDocument();
  });

  it('ticks and unticks the whole page from the header', async () => {
    const { user } = renderAsAdmin();
    const selectAll = table().getByLabelText('Select every account on this page');

    await user.click(selectAll);
    expect(bar().getByText('5 accounts selected')).toBeInTheDocument();

    await user.click(selectAll);
    expect(screen.queryByRole('group', { name: 'Bulk actions' })).not.toBeInTheDocument();
  });

  it('drops the selection when the filters change', async () => {
    const { user } = renderAsAdmin();

    await user.click(table().getByLabelText('Select Dana Diaz'));
    await user.selectOptions(screen.getByLabelText('Role'), 'MEMBER');

    expect(screen.queryByRole('group', { name: 'Bulk actions' })).not.toBeInTheDocument();
  });

  it('clears the selection on request', async () => {
    const { user } = renderAsAdmin();

    await user.click(table().getByLabelText('Select Dana Diaz'));
    await user.click(bar().getByRole('button', { name: 'Clear selection' }));

    expect(screen.queryByRole('group', { name: 'Bulk actions' })).not.toBeInTheDocument();
  });
});

describe('acting on a selection', () => {
  it('asks before it deactivates, and says what it did', async () => {
    const { user } = renderAsAdmin();

    await user.click(table().getByLabelText('Select Dana Diaz'));
    await user.click(table().getByLabelText('Select Raj Patel'));
    await user.click(bar().getByRole('button', { name: 'Deactivate' }));

    expect(screen.getByRole('dialog', { name: 'Deactivate 2 accounts' })).toBeInTheDocument();
    expect(isActive('dana@example.com')).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Deactivate 2 accounts' }));

    expect(await screen.findByText(/Deactivated 2 accounts/)).toBeInTheDocument();
    expect(isActive('dana@example.com')).toBe(false);
    expect(isActive('raj@example.com')).toBe(false);
  });

  it('backs out without touching anything', async () => {
    const { user } = renderAsAdmin();

    await user.click(table().getByLabelText('Select Dana Diaz'));
    await user.click(bar().getByRole('button', { name: 'Deactivate' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(isActive('dana@example.com')).toBe(true);
    expect(bar().getByText('1 account selected')).toBeInTheDocument();
  });

  it('lists what was refused, and why', async () => {
    const { user } = renderAsAdmin();

    await user.click(table().getByLabelText('Select Avery Admin'));
    await user.click(table().getByLabelText('Select Dana Diaz'));
    await user.click(bar().getByRole('button', { name: 'Deactivate' }));
    await user.click(screen.getByRole('button', { name: 'Deactivate 2 accounts' }));

    expect(await screen.findByText(/Deactivated 1 account/)).toBeInTheDocument();
    expect(screen.getByText('Refused')).toBeInTheDocument();
    expect(
      screen.getByText(/Admins cannot change their own role or deactivate their own account/),
    ).toBeInTheDocument();
    expect(isActive('admin@example.com')).toBe(true);
  });

  it('separates the accounts that needed no change', async () => {
    const { user } = renderAsAdmin();

    // Sam Lee is seeded deactivated, so deactivating the page catches one that is already there.
    await user.click(table().getByLabelText('Select Sam Lee'));
    await user.click(table().getByLabelText('Select Mira Okafor'));
    await user.click(bar().getByRole('button', { name: 'Deactivate' }));
    await user.click(screen.getByRole('button', { name: 'Deactivate 2 accounts' }));

    expect(await screen.findByText(/1 account needed no change/)).toBeInTheDocument();
    expect(screen.getByText('Left alone')).toBeInTheDocument();
    expect(screen.getByText(/Already deactivated/)).toBeInTheDocument();
  });

  it('deletes a selection and drops it from the table', async () => {
    const { user } = renderAsAdmin();

    await user.click(table().getByLabelText('Select Mira Okafor'));
    await user.click(bar().getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete 1 account' }));

    expect(await screen.findByText(/Deleted 1 account/)).toBeInTheDocument();
    expect(table().queryByText('Mira Okafor')).not.toBeInTheDocument();
  });

  it('lets go of the selection once the batch has run', async () => {
    const { user } = renderAsAdmin();

    await user.click(table().getByLabelText('Select Dana Diaz'));
    await user.click(bar().getByRole('button', { name: 'Deactivate' }));
    await user.click(screen.getByRole('button', { name: 'Deactivate 1 account' }));

    expect(await screen.findByText(/Deactivated 1 account/)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Bulk actions' })).not.toBeInTheDocument();
  });

  it('lets go of an account deleted from its own row', async () => {
    const { user } = renderAsAdmin();
    const row = table().getByText('Mira Okafor').closest('tr') as HTMLElement;

    await user.click(table().getByLabelText('Select Mira Okafor'));
    await user.click(table().getByLabelText('Select Dana Diaz'));
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    await user.click(within(row).getByRole('button', { name: 'Confirm delete' }));

    // The selection carries across pages, so an id deleted underneath it would otherwise
    // stay held and invisible, and the next batch would report it as "User not found".
    expect(await bar().findByText('1 account selected')).toBeInTheDocument();

    await user.click(bar().getByRole('button', { name: 'Deactivate' }));
    await user.click(screen.getByRole('button', { name: 'Deactivate 1 account' }));

    expect(await screen.findByText(/Deactivated 1 account/)).toBeInTheDocument();
    expect(screen.queryByText('Refused')).not.toBeInTheDocument();
  });

  it('clears an older export notice when a batch reports', async () => {
    const { user } = renderAsAdmin();

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText(/Exported 5 accounts/)).toBeInTheDocument();

    await user.click(table().getByLabelText('Select Dana Diaz'));
    await user.click(bar().getByRole('button', { name: 'Deactivate' }));
    await user.click(screen.getByRole('button', { name: 'Deactivate 1 account' }));

    expect(await screen.findByText(/Deactivated 1 account/)).toBeInTheDocument();
    expect(screen.queryByText(/Exported 5 accounts/)).not.toBeInTheDocument();
  });

  it('unlocks the accounts that are actually locked', async () => {
    const raj = getDatabase().users.find((candidate) => candidate.email === 'raj@example.com');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      lockout.recordSignInAttempt({
        email: 'raj@example.com',
        userId: raj?.id ?? null,
        outcome: 'FAILED',
      });
    }

    const { user } = renderAsAdmin();
    expect(
      within(table().getByText('Raj Patel').closest('tr') as HTMLElement).getByText('Locked'),
    ).toBeInTheDocument();

    await user.click(table().getByLabelText('Select Raj Patel'));
    await user.click(table().getByLabelText('Select Dana Diaz'));
    await user.click(bar().getByRole('button', { name: 'Unlock' }));
    await user.click(screen.getByRole('button', { name: 'Unlock 2 accounts' }));

    expect(await screen.findByText(/Unlocked 1 account/)).toBeInTheDocument();
    expect(screen.getByText(/Not locked out/)).toBeInTheDocument();
    expect(lockout.lockStateFor('raj@example.com').isLocked).toBe(false);
  });
});
