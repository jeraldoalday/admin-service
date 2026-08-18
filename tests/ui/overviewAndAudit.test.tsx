import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { teams, users } from '@/domain';
import { adminActor, danaActor, miraActor, teamIdBySlug } from '../helpers';
import { renderApp } from '../renderApp';

describe('the overview', () => {
  it('summarises what an admin can reach', () => {
    renderApp({ userId: adminActor().id });

    expect(screen.getByRole('link', { name: /1\s*Teams you belong to/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /5\s*Accounts on the platform/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recent activity' })).toBeInTheDocument();
  });

  it('leaves the platform-wide figures out for a member', () => {
    renderApp({ userId: danaActor().id });

    expect(screen.getByRole('link', { name: /2\s*Teams you belong to/ })).toBeInTheDocument();
    expect(screen.queryByText('Accounts on the platform')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Recent activity' })).not.toBeInTheDocument();
  });

  it('points a user with no teams at creating one', () => {
    const mira = miraActor();
    teams.leaveTeam(mira, teamIdBySlug('growth'));

    renderApp({ userId: mira.id });

    expect(screen.getByText(/You are not a member of any team yet/)).toBeInTheDocument();
  });

  it('navigates to a team from the overview', async () => {
    const { user } = renderApp({ userId: adminActor().id });

    await user.click(screen.getByRole('link', { name: 'Platform' }));

    expect(await screen.findByRole('button', { name: 'Members' })).toBeInTheDocument();
  });
});

describe('the audit log screen', () => {
  it('lists seeded activity newest first', () => {
    renderApp({ route: '/audit-logs', userId: adminActor().id });

    const rows = within(screen.getByRole('table')).getAllByRole('row');
    // Header plus the four seeded entries.
    expect(rows).toHaveLength(5);
    expect(rows[1]).toHaveTextContent('user.updated');
  });

  it('records an action performed elsewhere in the console', async () => {
    const admin = adminActor();
    users.updateUser(admin, danaActor().id, { displayName: 'Dana D.' });

    const { user } = renderApp({ route: '/audit-logs', userId: admin.id });
    await user.selectOptions(screen.getByLabelText('Action'), 'user.updated');

    const table = within(screen.getByRole('table'));
    expect(table.getAllByRole('row')).toHaveLength(3);
    expect(table.getByText('{"displayName":"Dana D."}')).toBeInTheDocument();
  });

  it('exports everything the filters match, not just the visible page', async () => {
    const admin = adminActor();
    users.updateUser(admin, danaActor().id, { displayName: 'Dana D.' });

    // jsdom implements neither object URLs nor navigation, so stand in for both and assert
    // on the document that would have been handed to the reader.
    const created: string[] = [];
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => {
        created.push(String(blob.type));
        return 'blob:audit';
      },
      revokeObjectURL: () => undefined,
    });
    const clicks = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);

    const { user } = renderApp({ route: '/audit-logs', userId: admin.id });
    await user.selectOptions(screen.getByLabelText('Action'), 'user.updated');
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(clicks).toHaveBeenCalledOnce();
    expect(created[0]).toContain('text/csv');
    expect(await screen.findByRole('status')).toHaveTextContent('Exported 2 entries');
  });

  it('says so when a filter matches nothing', async () => {
    const { user } = renderApp({ route: '/audit-logs', userId: adminActor().id });

    await user.selectOptions(screen.getByLabelText('Action'), 'api_key.created');
    await user.selectOptions(screen.getByLabelText('Target type'), 'user');

    expect(await screen.findByText('No entries match these filters.')).toBeInTheDocument();
  });
});
