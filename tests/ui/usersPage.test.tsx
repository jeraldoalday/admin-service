import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { getDatabase, users } from '@/domain';
import { adminActor } from '../helpers';
import { renderApp } from '../renderApp';

function renderAsAdmin(route = '/users') {
  return renderApp({ route, userId: adminActor().id });
}

/** Queries scoped to the results table — the signed-in admin's name also appears in the sidebar. */
function table() {
  return within(screen.getByRole('table'));
}

function rowFor(name: string): HTMLElement {
  const row = table().getByText(name).closest('tr');
  if (!row) throw new Error(`No table row for ${name}`);
  return row;
}

describe('the users screen', () => {
  it('lists every account', () => {
    renderAsAdmin();

    expect(screen.getByRole('heading', { name: 'Users' })).toBeInTheDocument();
    expect(table().getByText('Avery Admin')).toBeInTheDocument();
    expect(table().getByText('Raj Patel')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(6); // five accounts plus the header
  });

  it('narrows the list as you search', async () => {
    const { user } = renderAsAdmin();

    await user.type(screen.getByLabelText('Search'), 'okafor');

    expect(await table().findByText('Mira Okafor')).toBeInTheDocument();
    expect(table().queryByText('Raj Patel')).not.toBeInTheDocument();
  });

  it('filters by status', async () => {
    const { user } = renderAsAdmin();

    await user.selectOptions(screen.getByLabelText('Status'), 'false');

    expect(await table().findByText('Sam Lee')).toBeInTheDocument();
    expect(table().queryByText('Avery Admin')).not.toBeInTheDocument();
  });

  it('edits an account and reflects the change immediately', async () => {
    const { user } = renderAsAdmin();

    await user.click(within(rowFor('Dana Diaz')).getByRole('button', { name: 'Edit' }));

    const nameField = screen.getByLabelText('Display name');
    await user.clear(nameField);
    await user.type(nameField, 'Dana D.');
    await user.selectOptions(screen.getByLabelText('Platform role'), 'ADMIN');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await table().findByText('Dana D.')).toBeInTheDocument();
    expect(table().getAllByText('ADMIN')).toHaveLength(2);
  });

  it('will not let an admin demote themselves', async () => {
    const { user } = renderAsAdmin();

    await user.click(within(rowFor('Avery Admin')).getByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText('Platform role')).toBeDisabled();
    expect(screen.getByText('You cannot change your own role.')).toBeInTheDocument();
  });

  it('deletes an account only after the action is confirmed', async () => {
    const { user } = renderAsAdmin();

    await user.click(within(rowFor('Mira Okafor')).getByRole('button', { name: 'Delete' }));

    expect(getDatabase().users).toHaveLength(5);

    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));

    expect(table().queryByText('Mira Okafor')).not.toBeInTheDocument();
    expect(users.listUsers(adminActor()).total).toBe(4);
  });

  it('reports a refused deletion instead of failing silently', async () => {
    const { user } = renderAsAdmin();

    await user.click(within(rowFor('Avery Admin')).getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Admins cannot delete their own account',
    );
  });
});
