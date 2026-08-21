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

  it('names who performed each entry rather than showing an opaque id', () => {
    renderApp({ route: '/audit-logs', userId: adminActor().id });

    const table = within(screen.getByRole('table'));
    expect(table.getAllByText('Avery Admin (admin@example.com)')).toHaveLength(4);
    expect(table.queryByText(adminActor().id)).not.toBeInTheDocument();
  });

  it('narrows the log to one actor', async () => {
    const dana = danaActor();
    teams.updateTeam(dana, teamIdBySlug('growth'), { name: 'Growth Core' });

    const { user } = renderApp({ route: '/audit-logs', userId: adminActor().id });
    await user.selectOptions(screen.getByLabelText('Actor'), dana.id);

    const table = within(screen.getByRole('table'));
    expect(table.getAllByRole('row')).toHaveLength(2);
    expect(table.getByText('Dana Diaz (dana@example.com)')).toBeInTheDocument();
  });

  it('searches the details, where the interesting part of an entry lives', async () => {
    const admin = adminActor();
    teams.createInvite(admin, teamIdBySlug('platform'), { email: 'searchable@example.com' });

    const { user } = renderApp({ route: '/audit-logs', userId: admin.id });
    await user.type(screen.getByLabelText('Search'), 'searchable@example.com');

    const table = within(screen.getByRole('table'));
    expect(table.getAllByRole('row')).toHaveLength(2);
    expect(table.getByText('team.invite.created')).toBeInTheDocument();
  });

  it('puts the search and the actor back with the other filters when cleared', async () => {
    const { user } = renderApp({ route: '/audit-logs', userId: adminActor().id });

    await user.type(screen.getByLabelText('Search'), 'nothing-matches-this');
    expect(await screen.findByText('No entries match these filters.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(screen.getByLabelText('Search')).toHaveValue('');
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(5);
  });

  it('narrows the log to one team, and marks what belongs to none', async () => {
    const admin = adminActor();
    users.updateUser(admin, danaActor().id, { displayName: 'Dana D.' });

    const { user } = renderApp({ route: '/audit-logs', userId: admin.id });
    await user.selectOptions(screen.getByLabelText('Team'), teamIdBySlug('platform'));

    const table = within(screen.getByRole('table'));
    expect(table.getAllByText('Platform').length).toBeGreaterThan(0);
    expect(table.queryByText('user.updated')).not.toBeInTheDocument();
  });

  it('keeps a deleted team reachable by the entries it left behind', async () => {
    const admin = adminActor();
    const doomed = teams.createTeam(admin, { name: 'Doomed' });
    teams.deleteTeam(admin, doomed.id);

    const { user } = renderApp({ route: '/audit-logs', userId: admin.id });
    await user.selectOptions(screen.getByLabelText('Team'), doomed.id);

    const table = within(screen.getByRole('table'));
    expect(table.getByText('team.deleted')).toBeInTheDocument();
    expect(table.getAllByText(doomed.id).length).toBeGreaterThan(0);
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

  it('narrows the log to a date range and clears back out again', async () => {
    const { user } = renderApp({ route: '/audit-logs', userId: adminActor().id });
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    await user.type(screen.getByLabelText('From'), tomorrow);

    expect(await screen.findByText('No entries match these filters.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('reports a range that ends before it starts instead of falling over', async () => {
    const { user } = renderApp({ route: '/audit-logs', userId: adminActor().id });

    await user.type(screen.getByLabelText('From'), '2026-08-19');
    await user.type(screen.getByLabelText('To'), '2026-08-18');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The start of the range must not be after its end',
    );
    // The controls keep what was typed, so the reader can fix the end date they got wrong.
    expect(screen.getByLabelText('From')).toHaveValue('2026-08-19');
  });

  it('says so when a filter matches nothing', async () => {
    const { user } = renderApp({ route: '/audit-logs', userId: adminActor().id });

    await user.selectOptions(screen.getByLabelText('Action'), 'api_key.created');
    await user.selectOptions(screen.getByLabelText('Target type'), 'user');

    expect(await screen.findByText('No entries match these filters.')).toBeInTheDocument();
  });
});
