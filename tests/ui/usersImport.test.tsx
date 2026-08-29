import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { audit, getDatabase } from '@/domain';
import { adminActor } from '../helpers';
import { renderApp } from '../renderApp';

const FILE =
  'email,name,role\r\nnoor@example.com,Noor Haddad,MEMBER\r\nkai@example.com,Kai Bell,ADMIN';

function renderAsAdmin() {
  return renderApp({ route: '/users', userId: adminActor().id });
}

function dialog() {
  return within(screen.getByRole('dialog', { name: 'Import accounts' }));
}

async function openImport() {
  const rendered = renderAsAdmin();
  await rendered.user.click(screen.getByRole('button', { name: 'Import CSV' }));
  return rendered;
}

async function paste(user: ReturnType<typeof renderAsAdmin>['user'], text: string) {
  // `type` would interpret the newlines; the file is pasted in one go, as a person would.
  await user.click(dialog().getByLabelText('Or paste the rows'));
  await user.paste(text);
}

function accountFor(email: string) {
  return getDatabase().users.find((user) => user.email === email);
}

describe('the import dialog', () => {
  it('opens from the users screen', async () => {
    await openImport();

    expect(screen.getByRole('dialog', { name: 'Import accounts' })).toBeInTheDocument();
    expect(dialog().getByLabelText('CSV file')).toBeInTheDocument();
  });

  it('will not check an empty box', async () => {
    await openImport();

    expect(dialog().getByRole('button', { name: 'Check file' })).toBeDisabled();
  });

  it('explains a file it cannot read', async () => {
    const { user } = await openImport();

    await paste(user, 'name,role\r\nNoor Haddad,MEMBER');
    await user.click(dialog().getByRole('button', { name: 'Check file' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('needs a column named email');
  });

  it('previews what it would do without writing anything', async () => {
    const { user } = await openImport();
    const before = getDatabase().users.length;

    await paste(user, `${FILE}\r\ndana@example.com,Dana Diaz,\r\nbroken-row,No Address,`);
    await user.click(dialog().getByRole('button', { name: 'Check file' }));

    expect(dialog().getByText(/2 to create/)).toBeInTheDocument();
    expect(dialog().getByText(/1 already here/)).toBeInTheDocument();
    expect(dialog().getByText(/1 that cannot be read/)).toBeInTheDocument();
    expect(dialog().getByText('An account already has this address')).toBeInTheDocument();
    expect(getDatabase().users).toHaveLength(before);
  });

  it('forgets the preview as soon as the rows are edited', async () => {
    const { user } = await openImport();

    await paste(user, FILE);
    await user.click(dialog().getByRole('button', { name: 'Check file' }));
    expect(dialog().getByRole('button', { name: 'Import 2 accounts' })).toBeEnabled();

    await user.type(dialog().getByLabelText('Or paste the rows'), 'x');

    expect(dialog().getByRole('button', { name: 'Import' })).toBeDisabled();
  });

  it('creates the accounts and shows each password once', async () => {
    const { user } = await openImport();

    await paste(user, FILE);
    await user.click(dialog().getByRole('button', { name: 'Check file' }));
    await user.click(dialog().getByRole('button', { name: 'Import 2 accounts' }));

    expect(await dialog().findByText(/Created 2 accounts/)).toBeInTheDocument();
    expect(dialog().getByText(/shown once and are not stored/)).toBeInTheDocument();
    expect(accountFor('noor@example.com')?.role).toBe('MEMBER');
    expect(accountFor('kai@example.com')?.role).toBe('ADMIN');

    const shown = dialog().getAllByText(/^tmp-[0-9a-f]{18}$/);
    expect(shown).toHaveLength(2);
  });

  it('puts the new accounts on the table behind it', async () => {
    const { user } = await openImport();

    await paste(user, FILE);
    await user.click(dialog().getByRole('button', { name: 'Check file' }));
    await user.click(dialog().getByRole('button', { name: 'Import 2 accounts' }));
    await user.click(await dialog().findByRole('button', { name: 'Done' }));

    expect(within(screen.getByRole('table')).getByText('Noor Haddad')).toBeInTheDocument();
    expect(audit.listAllAuditLogs({ action: 'user.imported' })).toHaveLength(2);
  });

  it('reads a file that was chosen rather than pasted', async () => {
    const { user } = await openImport();
    const file = new File([FILE], 'accounts.csv', { type: 'text/csv' });

    await user.upload(dialog().getByLabelText('CSV file'), file);
    await user.click(await dialog().findByRole('button', { name: 'Check file' }));

    expect(await dialog().findByText(/2 to create/)).toBeInTheDocument();
  });
});
