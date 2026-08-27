import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { audit, auth, getDatabase, users } from '@/domain';
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

  it('lets an admin rename their own account', async () => {
    const { user } = renderAsAdmin();

    await user.click(within(rowFor('Avery Admin')).getByRole('button', { name: 'Edit' }));

    const nameField = screen.getByLabelText('Display name');
    await user.clear(nameField);
    await user.type(nameField, 'Avery A.');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    // Renaming yourself cannot lock you out, so it must not trip the self-guard that stops
    // an admin changing their own role or deactivating themselves.
    expect(await table().findByText('Avery A.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('records only the fields that actually changed', async () => {
    const { user } = renderAsAdmin();

    await user.click(within(rowFor('Dana Diaz')).getByRole('button', { name: 'Edit' }));
    const nameField = screen.getByLabelText('Display name');
    await user.clear(nameField);
    await user.type(nameField, 'Dana D.');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(audit.listAuditLogs({ action: 'user.updated' }).items[0]?.metadata).toEqual({
      displayName: 'Dana D.',
    });
  });

  it('closes without writing anything when nothing was edited', async () => {
    const { user } = renderAsAdmin();
    const before = audit.listAuditLogs({ action: 'user.updated' }).total;

    await user.click(within(rowFor('Dana Diaz')).getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(audit.listAuditLogs({ action: 'user.updated' }).total).toBe(before);
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

describe('the edit dialog', () => {
  it('moves focus into the dialog and back to the control that opened it', async () => {
    const { user } = renderAsAdmin();
    const openButton = within(rowFor('Dana Diaz')).getByRole('button', { name: 'Edit' });

    await user.click(openButton);
    expect(screen.getByRole('dialog')).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(openButton).toHaveFocus();
  });

  it('closes on Escape', async () => {
    const { user } = renderAsAdmin();
    await user.click(within(rowFor('Dana Diaz')).getByRole('button', { name: 'Edit' }));

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps Tab inside the dialog rather than letting it walk out the back', async () => {
    const { user } = renderAsAdmin();
    await user.click(within(rowFor('Dana Diaz')).getByRole('button', { name: 'Edit' }));

    const dialog = screen.getByRole('dialog');
    const close = within(dialog).getByRole('button', { name: 'Close' });
    const save = within(dialog).getByRole('button', { name: 'Save changes' });

    save.focus();
    await user.tab();
    expect(close).toHaveFocus();

    await user.tab({ shift: true });
    expect(save).toHaveFocus();
  });

  it('leaves what was typed alone while the dialog re-renders', async () => {
    const { user } = renderAsAdmin();
    await user.click(within(rowFor('Dana Diaz')).getByRole('button', { name: 'Edit' }));

    const field = screen.getByLabelText('Display name');
    await user.clear(field);
    await user.type(field, 'Dana D.');

    expect(field).toHaveFocus();
    expect(field).toHaveValue('Dana D.');
  });
});

/** The visible order of the name column, which is what a reader actually sees. */
function namesInOrder(): string[] {
  return table()
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.querySelectorAll('td')[0]?.textContent ?? '');
}

describe('ordering the account list', () => {
  it('opens newest first, with no column claiming to be sorted', () => {
    renderAsAdmin();

    expect(namesInOrder()).toEqual([
      'Sam Lee',
      'Mira Okafor',
      'Raj Patel',
      'Dana Diaz',
      'Avery Admin',
    ]);
    expect(screen.getByRole('columnheader', { name: /Name/ })).not.toHaveAttribute('aria-sort');
  });

  it('sorts by a column from its header', async () => {
    const { user } = renderAsAdmin();

    await user.click(screen.getByRole('button', { name: /Name/ }));

    expect(namesInOrder()).toEqual([
      'Avery Admin',
      'Dana Diaz',
      'Mira Okafor',
      'Raj Patel',
      'Sam Lee',
    ]);
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('flips the direction when the same header is clicked again', async () => {
    const { user } = renderAsAdmin();

    await user.click(screen.getByRole('button', { name: /Name/ }));
    await user.click(screen.getByRole('button', { name: /Name/ }));

    expect(namesInOrder()[0]).toBe('Sam Lee');
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('starts a new column in the direction that column reads best', async () => {
    const { user } = renderAsAdmin();

    // Email opens A-to-Z even though the list was on a descending column beforehand.
    await user.click(screen.getByRole('button', { name: /Joined/ }));
    await user.click(screen.getByRole('button', { name: /Email/ }));

    expect(screen.getByRole('columnheader', { name: /Email/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(namesInOrder()[0]).toBe('Avery Admin');
  });

  it('keeps the filters while the order changes', async () => {
    const { user } = renderAsAdmin();

    await user.selectOptions(screen.getByLabelText('Role'), 'MEMBER');
    await user.click(screen.getByRole('button', { name: /Name/ }));

    expect(namesInOrder()).toEqual(['Dana Diaz', 'Mira Okafor', 'Raj Patel', 'Sam Lee']);
  });

  it('goes back to the first page when the order changes', async () => {
    // Ten rows to a page, so six more accounts is enough to make a second one.
    for (let index = 0; index < 6; index += 1) {
      auth.registerUser({
        email: `filler${index}@example.com`,
        password: 'a-good-password',
        displayName: `Filler ${index}`,
      });
    }
    const { user } = renderAsAdmin();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText(/Page 2 of/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Name/ }));
    expect(screen.getByText(/Page 1 of/)).toBeInTheDocument();
  });

  it('leaves columns that cannot be ordered as plain headers', () => {
    renderAsAdmin();

    expect(screen.queryByRole('button', { name: 'Status' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
  });
});

describe('exporting accounts', () => {
  it('writes every account the filters match to a CSV', async () => {
    // jsdom implements neither object URLs nor navigation, so stand in for both and assert
    // on the document that would have been handed to the reader.
    const documents: string[] = [];
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => {
        void blob.text().then((text) => documents.push(text));
        return 'blob:users';
      },
      revokeObjectURL: () => undefined,
    });
    const clicks = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    const { user } = renderAsAdmin();
    await user.selectOptions(screen.getByLabelText('Status'), 'false');
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(clicks).toHaveBeenCalledOnce();
    expect(await screen.findByRole('status')).toHaveTextContent('Exported 1 account');
    await vi.waitFor(() => expect(documents[0]).toContain('Sam Lee'));
    expect(documents[0]).toContain('Name,Email,Role,Status,Locked until,Joined,Updated');
    expect(documents[0]).not.toContain('Avery Admin');
  });

  it('clears the export notice as soon as the filters move on', async () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => 'blob:users',
      revokeObjectURL: () => undefined,
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const { user } = renderAsAdmin();
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByRole('status')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Role'), 'ADMIN');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
