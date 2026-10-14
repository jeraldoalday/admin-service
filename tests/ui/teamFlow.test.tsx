import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { apiKeys, getDatabase, teams } from '@/domain';
import {
  adminActor,
  createUser,
  danaActor,
  grant,
  joinTeam,
  miraActor,
  rajActor,
  teamIdBySlug,
} from '../helpers';
import { renderApp } from '../renderApp';

function openTeam(actorId: string, slug = 'platform') {
  return renderApp({ route: `/teams/${teamIdBySlug(slug)}`, userId: actorId });
}

describe('the team screen', () => {
  it('shows an owner every section', () => {
    openTeam(adminActor().id);

    expect(screen.getByRole('heading', { name: 'Platform' })).toBeInTheDocument();
    ['Members', 'Invites', 'API keys', 'Activity', 'Settings'].forEach((tab) => {
      expect(screen.getByRole('button', { name: tab })).toBeInTheDocument();
    });
  });

  it('shows a plain member only the sections their permissions cover', () => {
    // Mira is a MEMBER of Growth with no grants at all.
    openTeam(miraActor().id, 'growth');

    expect(screen.getByRole('button', { name: 'Members' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invites' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'API keys' })).not.toBeInTheDocument();
  });

  it('opens the Invites section for a member holding only MANAGE_INVITES', () => {
    // Raj is a MEMBER of Platform, granted MANAGE_INVITES and nothing else.
    openTeam(rajActor().id);

    expect(screen.getByRole('button', { name: 'Invites' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'API keys' })).not.toBeInTheDocument();
  });

  it('hides a team you do not belong to', () => {
    renderApp({ route: `/teams/${teamIdBySlug('growth')}`, userId: adminActor().id });

    expect(screen.getByRole('alert')).toHaveTextContent('Team not found');
  });

  it('leaves role controls out of reach for a member who cannot manage members', () => {
    openTeam(rajActor().id);

    expect(screen.queryByLabelText('Team role for Raj Patel')).not.toBeInTheDocument();
    expect(screen.getAllByText('OWNER').length).toBeGreaterThan(0);
  });
});

describe('managing members', () => {
  it('changes a role from the table', async () => {
    const { user } = openTeam(adminActor().id);

    await user.selectOptions(screen.getByLabelText('Team role for Raj Patel'), 'ADMIN');

    expect(
      teams
        .listTeamMembers(adminActor(), teamIdBySlug('platform'))
        .items.find((member) => member.userId === rajActor().id)?.role,
    ).toBe('ADMIN');
  });

  it('does not offer OWNER in the role select to a caller who is not one', () => {
    // Dana is a team ADMIN on Platform, not an OWNER — the domain layer refuses an
    // ADMIN promoting anyone to OWNER, so the select should not offer it either.
    openTeam(danaActor().id);

    const select = screen.getByLabelText('Team role for Raj Patel') as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['ADMIN', 'MEMBER']);
  });

  it('does not offer ADMIN in the role select to a caller who lacks every permission it carries', () => {
    // Raj holds only MANAGE_MEMBERS on Platform — enough to change a role, but not enough to
    // promote someone into a role that also carries the other four permissions, which the
    // domain layer refuses the same way it refuses an ADMIN promoting anyone to OWNER.
    grant(adminActor(), teamIdBySlug('platform'), rajActor().id, ['MANAGE_MEMBERS']);

    openTeam(rajActor().id);

    const select = screen.getByLabelText('Team role for Raj Patel') as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual(['MEMBER']);
  });

  it('shows a co-owner as a read-only badge, with no remove option, to a non-owner', () => {
    // Dana is promoted to a second owner, and raj is granted MANAGE_MEMBERS without ever
    // holding OWNER — the domain layer refuses raj changing or removing an owner, so the
    // row should not offer a select or a Remove button that would only error.
    teams.updateMemberRole(adminActor(), teamIdBySlug('platform'), danaActor().id, 'OWNER');
    grant(adminActor(), teamIdBySlug('platform'), rajActor().id, ['MANAGE_MEMBERS']);

    openTeam(rajActor().id);

    expect(screen.queryByLabelText('Team role for Dana Diaz')).not.toBeInTheDocument();
    const row = screen.getByText('Dana Diaz').closest('tr') as HTMLElement;
    expect(within(row).getByText('OWNER')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });

  it('explains why the last owner cannot be demoted', async () => {
    const { user } = openTeam(adminActor().id);

    await user.selectOptions(screen.getByLabelText('Team role for Avery Admin'), 'MEMBER');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A team must have at least one owner',
    );
  });

  it('grants a permission without promoting the member', async () => {
    const { user } = openTeam(adminActor().id);

    const row = screen.getByText('Raj Patel').closest('tr');
    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Permissions' }));

    const dialog = within(screen.getByRole('dialog'));
    await user.click(dialog.getByRole('checkbox', { name: /Manage api keys/ }));
    await user.click(dialog.getByRole('button', { name: 'Save grants' }));

    expect(await screen.findByText('Permissions updated.')).toBeInTheDocument();
    expect(() => apiKeys.listApiKeys(rajActor(), teamIdBySlug('platform'))).not.toThrow();
  });

  it('locks the permissions their role already carries', async () => {
    const { user } = openTeam(adminActor().id);

    const row = screen.getByText('Dana Diaz').closest('tr');
    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Permissions' }));

    const dialog = within(screen.getByRole('dialog'));
    dialog.getAllByRole('checkbox').forEach((checkbox) => {
      expect(checkbox).toBeChecked();
      expect(checkbox).toBeDisabled();
    });
  });
});

describe('invites', () => {
  it('creates one and surfaces the link to share', async () => {
    const { user } = openTeam(adminActor().id);
    await user.click(screen.getByRole('button', { name: 'Invites' }));

    await user.type(screen.getByLabelText('Email'), 'newcomer@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Invite link for newcomer@example.com');

    const invite = getDatabase().invites.find(
      (candidate) => candidate.email === 'newcomer@example.com',
    );
    expect(status).toHaveTextContent(invite?.token ?? 'missing token');
  });

  it('reports a duplicate invite rather than issuing a second one', async () => {
    const { user } = openTeam(adminActor().id);
    await user.click(screen.getByRole('button', { name: 'Invites' }));

    await user.type(screen.getByLabelText('Email'), 'noor@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'There is already a pending invite for this email',
    );
  });

  it('shows the link again for an invite that is still pending', async () => {
    const { user } = openTeam(adminActor().id);
    await user.click(screen.getByRole('button', { name: 'Invites' }));

    // Nothing was just created here: this is the seeded invite, and its link has to be
    // retrievable so it can be re-sent.
    await user.click(screen.getByRole('button', { name: 'Copy link' }));

    const seeded = getDatabase().invites.find(
      (candidate) => candidate.email === 'noor@example.com',
    );
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('noor@example.com');
    expect(notice).toHaveTextContent(seeded?.token ?? 'missing token');
  });

  it('offers no link once an invite is no longer pending', async () => {
    const { user } = openTeam(adminActor().id);
    await user.click(screen.getByRole('button', { name: 'Invites' }));

    await user.click(screen.getByRole('button', { name: 'Revoke' }));

    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
  });

  it('offers no link for an invite that has aged out, and says so', async () => {
    const seeded = getDatabase().invites.find(
      (candidate) => candidate.email === 'noor@example.com',
    );
    if (seeded) seeded.expiresAt = new Date(Date.now() - 1000).toISOString();

    const { user } = openTeam(adminActor().id);
    await user.click(screen.getByRole('button', { name: 'Invites' }));

    const table = within(screen.getByRole('table'));
    expect(table.getByText('EXPIRED')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy link' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('revokes a pending invite', async () => {
    const { user } = openTeam(adminActor().id);
    await user.click(screen.getByRole('button', { name: 'Invites' }));

    await user.click(screen.getByRole('button', { name: 'Revoke' }));

    const table = within(screen.getByRole('table'));
    expect(await table.findByText('REVOKED')).toBeInTheDocument();
  });
});

describe('accepting an invite', () => {
  it('joins the team when the signed-in email matches', async () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const invite = teams.createInvite(admin, platform, { email: 'mira@example.com' });

    const { user } = renderApp({ route: `/invites/${invite.token}`, userId: miraActor().id });
    await user.click(screen.getByRole('button', { name: 'Accept invite' }));

    expect(await screen.findByRole('status')).toHaveTextContent('You joined Platform');
    expect(teams.listTeamMembers(admin, platform).total).toBe(4);
  });

  it('refuses when the invite was addressed to someone else', async () => {
    const invite = teams.createInvite(adminActor(), teamIdBySlug('platform'), {
      email: 'someone.else@example.com',
    });

    const { user } = renderApp({ route: `/invites/${invite.token}`, userId: miraActor().id });
    await user.click(screen.getByRole('button', { name: 'Accept invite' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This invite was issued to a different email address',
    );
  });

  it('explains a dead invite on arrival instead of on the click', async () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const invite = teams.createInvite(admin, platform, { email: 'mira@example.com' });
    teams.revokeInvite(admin, platform, invite.id);

    renderApp({ route: `/invites/${invite.token}`, userId: miraActor().id });

    expect(await screen.findByRole('alert')).toHaveTextContent('This invite has been revoked.');
    expect(screen.queryByRole('button', { name: 'Accept invite' })).not.toBeInTheDocument();
  });

  it('sends an anonymous visitor to sign in first', () => {
    const invite = teams.createInvite(adminActor(), teamIdBySlug('platform'), {
      email: 'mira@example.com',
    });

    renderApp({ route: `/invites/${invite.token}` });

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});

describe('API keys', () => {
  it('shows a new secret once and then only its prefix', async () => {
    const { user } = openTeam(adminActor().id);
    await user.click(screen.getByRole('button', { name: 'API keys' }));

    await user.type(screen.getByLabelText('Key name'), 'deploy-bot');
    await user.click(screen.getByRole('checkbox', { name: /Manage members/ }));
    await user.click(screen.getByRole('button', { name: 'Create key' }));

    const banner = await screen.findByRole('status');
    const secret = getDatabase()
      .apiKeys.map((key) => key.keyPrefix)
      .find((prefix) => banner.textContent?.includes(prefix));

    expect(banner).toHaveTextContent('Copy the secret now');
    expect(secret).toBeDefined();
    expect(within(screen.getByRole('table')).getByText('deploy-bot')).toBeInTheDocument();
  });

  it('only offers scopes the caller holds themselves when minting a key', async () => {
    const platform = teamIdBySlug('platform');
    const owner = adminActor();
    const scoped = createUser('scoped-minter@example.com', 'Scoped Minter');
    joinTeam(owner, platform, scoped, 'scoped-minter@example.com');
    grant(owner, platform, scoped.id, ['MANAGE_API_KEYS']);

    const { user } = openTeam(scoped.id);
    await user.click(screen.getByRole('button', { name: 'API keys' }));

    const held = screen.getByRole('checkbox', { name: /Manage api keys/ });
    const notHeld = screen.getByRole('checkbox', { name: /Manage members/ });
    expect(held).toBeEnabled();
    expect(notHeld).toBeDisabled();
    expect(notHeld.closest('label')).toHaveTextContent('not held');
  });

  it('creates a key that expires today rather than rejecting it as already in the past', async () => {
    const { user } = openTeam(adminActor().id);
    await user.click(screen.getByRole('button', { name: 'API keys' }));

    const today = new Date().toISOString().slice(0, 10);
    await user.type(screen.getByLabelText('Key name'), 'expires-today');
    await user.type(screen.getByLabelText('Expires'), today);
    await user.click(screen.getByRole('button', { name: 'Create key' }));

    expect(await screen.findByText(/Copy the secret now/)).toBeInTheDocument();
    const stored = getDatabase().apiKeys.find((key) => key.name === 'expires-today');
    expect(stored?.expiresAt).toBe(`${today}T23:59:59.999Z`);
  });

  it('rejects a key the console did not just issue', async () => {
    const { user } = openTeam(adminActor().id);
    await user.click(screen.getByRole('button', { name: 'API keys' }));

    await user.type(screen.getByLabelText('API key secret'), 'sk_not_a_real_key');
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid or revoked API key');
  });

  it('authenticates a freshly issued in-scope key against the service endpoint', async () => {
    const platform = teamIdBySlug('platform');
    const { secret } = apiKeys.createApiKey(adminActor(), platform, {
      name: 'roster-reader',
      permissions: ['MANAGE_MEMBERS'],
    });

    const { user } = openTeam(adminActor().id);
    await user.click(screen.getByRole('button', { name: 'API keys' }));
    await user.type(screen.getByLabelText('API key secret'), secret);
    await user.click(screen.getByRole('button', { name: 'Send request' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Authenticated. The key read 3 members.',
    );
  });

  it('shows a lapsed key as expired, with nothing left to do to it', async () => {
    const platform = teamIdBySlug('platform');
    const { apiKey } = apiKeys.createApiKey(adminActor(), platform, {
      name: 'lapsed-key',
      permissions: [],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    const stored = getDatabase().apiKeys.find((candidate) => candidate.id === apiKey.id);
    if (stored) stored.expiresAt = new Date(Date.now() - 1000).toISOString();

    const { user } = openTeam(adminActor().id);
    await user.click(screen.getByRole('button', { name: 'API keys' }));

    const row = within(screen.getByText('lapsed-key').closest('tr') as HTMLElement);
    expect(row.getByText('EXPIRED')).toBeInTheDocument();
    expect(row.queryByRole('button', { name: 'Rotate' })).not.toBeInTheDocument();
    expect(row.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('warns about a key that is inside its last week', async () => {
    const platform = teamIdBySlug('platform');
    apiKeys.createApiKey(adminActor(), platform, {
      name: 'nearly-up',
      permissions: [],
      expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const { user } = openTeam(adminActor().id);
    await user.click(screen.getByRole('button', { name: 'API keys' }));

    expect(await screen.findByText(/Key "nearly-up" expires in 2 days/)).toBeInTheDocument();
  });

  it('leaves a key with a distant expiry unremarked', async () => {
    const platform = teamIdBySlug('platform');
    apiKeys.createApiKey(adminActor(), platform, {
      name: 'long-lived',
      permissions: [],
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    });

    const { user } = openTeam(adminActor().id);
    await user.click(screen.getByRole('button', { name: 'API keys' }));

    expect(screen.queryByText(/expires in/)).not.toBeInTheDocument();
  });

  it('filters the table down to the expired keys', async () => {
    const platform = teamIdBySlug('platform');
    const { apiKey } = apiKeys.createApiKey(adminActor(), platform, {
      name: 'lapsed-key',
      permissions: [],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    const stored = getDatabase().apiKeys.find((candidate) => candidate.id === apiKey.id);
    if (stored) stored.expiresAt = new Date(Date.now() - 1000).toISOString();

    const { user } = openTeam(adminActor().id);
    await user.click(screen.getByRole('button', { name: 'API keys' }));
    await user.selectOptions(screen.getByLabelText('Status'), 'EXPIRED');

    const table = within(screen.getByRole('table'));
    expect(table.getByText('lapsed-key')).toBeInTheDocument();
    expect(table.queryByText('ci-pipeline')).not.toBeInTheDocument();
  });

  it('revokes a key from the table', async () => {
    const platform = teamIdBySlug('platform');
    apiKeys.createApiKey(adminActor(), platform, { name: 'temp-key', permissions: [] });

    const { user } = openTeam(adminActor().id);
    await user.click(screen.getByRole('button', { name: 'API keys' }));

    const row = screen.getByText('temp-key').closest('tr');
    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Revoke' }));

    expect(apiKeys.listApiKeys(adminActor(), platform, { status: 'REVOKED' }).total).toBe(1);
  });
});

describe('team settings', () => {
  it('renames a team', async () => {
    const { user } = openTeam(adminActor().id);
    await user.click(screen.getByRole('button', { name: 'Settings' }));

    const nameField = screen.getByLabelText('Team name');
    await user.clear(nameField);
    await user.type(nameField, 'Platform Core');
    await user.click(screen.getByRole('button', { name: 'Rename team' }));

    expect(await screen.findByRole('heading', { name: 'Platform Core' })).toBeInTheDocument();
  });

  it('offers deletion only to an owner', async () => {
    const { user } = openTeam(danaActor().id);
    await user.click(screen.getByRole('button', { name: 'Settings' }));

    // Dana is a team ADMIN on Platform: full permissions, but deletion stays owner-only.
    expect(screen.getByRole('button', { name: 'Rename team' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete team' })).not.toBeInTheDocument();
  });

  it('deletes a team after confirmation and returns to the team list', async () => {
    const { user } = openTeam(adminActor().id);
    await user.click(screen.getByRole('button', { name: 'Settings' }));

    await user.click(screen.getByRole('button', { name: 'Delete team' }));
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }));

    expect(await screen.findByRole('heading', { name: 'Teams' })).toBeInTheDocument();
    expect(getDatabase().teams).toHaveLength(1);
  });

  it('explains why the last owner cannot leave', async () => {
    const { user } = openTeam(adminActor().id);
    await user.click(screen.getByRole('button', { name: 'Settings' }));

    await user.click(screen.getByRole('button', { name: 'Leave team' }));
    await user.click(screen.getByRole('button', { name: 'Confirm leave' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The last owner cannot leave the team',
    );
  });
});

describe('creating a team', () => {
  it('adds it to your list with you as owner', async () => {
    const { user } = renderApp({ route: '/teams', userId: miraActor().id });

    await user.type(screen.getByLabelText('Team name'), 'Support');
    await user.click(screen.getByRole('button', { name: 'Create team' }));

    expect(await screen.findByRole('link', { name: 'Support' })).toBeInTheDocument();
    expect(screen.getAllByText('OWNER')).toHaveLength(1);
  });
});
