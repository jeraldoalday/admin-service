import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { apiKeys, teams } from '@/domain';
import { adminActor, danaActor, grant, miraActor, rajActor, teamIdBySlug } from '../helpers';
import { renderApp } from '../renderApp';

function openTeam(actorId: string, slug = 'platform') {
  return renderApp({ route: `/teams/${teamIdBySlug(slug)}`, userId: actorId });
}

async function openActivity(actorId: string, slug = 'platform') {
  const rendered = openTeam(actorId, slug);
  await rendered.user.click(screen.getByRole('button', { name: 'Activity' }));
  return rendered;
}

function table() {
  return within(screen.getByRole('table'));
}

describe('the activity tab', () => {
  it('is offered to an owner', () => {
    openTeam(adminActor().id);

    expect(screen.getByRole('button', { name: 'Activity' })).toBeInTheDocument();
  });

  it('is hidden from a member who cannot manage the team', () => {
    // Raj holds MANAGE_INVITES on Platform and nothing else.
    openTeam(rajActor().id);

    expect(screen.queryByRole('button', { name: 'Activity' })).not.toBeInTheDocument();
  });

  it('appears for a plain member once MANAGE_TEAM is granted', () => {
    grant(adminActor(), teamIdBySlug('platform'), rajActor().id, ['MANAGE_TEAM']);
    openTeam(rajActor().id);

    expect(screen.getByRole('button', { name: 'Activity' })).toBeInTheDocument();
  });

  it('shows what has happened to this team, and who did it', async () => {
    apiKeys.createApiKey(adminActor(), teamIdBySlug('platform'), {
      name: 'deploy-bot',
      permissions: [],
    });
    await openActivity(adminActor().id);

    expect(table().getAllByText('api_key.created').length).toBeGreaterThan(0);
    expect(table().getAllByText('Avery Admin (admin@example.com)').length).toBeGreaterThan(0);
  });

  it("leaves another team's history out of it", async () => {
    teams.updateTeam(danaActor(), teamIdBySlug('growth'), { name: 'Growth Core' });
    await openActivity(adminActor().id);

    expect(screen.queryByText(/Growth Core/)).not.toBeInTheDocument();
  });

  it('narrows by free text', async () => {
    apiKeys.createApiKey(adminActor(), teamIdBySlug('platform'), {
      name: 'deploy-bot',
      permissions: [],
    });
    const { user } = await openActivity(adminActor().id);

    await user.type(screen.getByLabelText('Search'), 'deploy-bot');

    expect(await table().findByText(/deploy-bot/)).toBeInTheDocument();
    expect(table().queryByText('team.created')).not.toBeInTheDocument();
  });

  it('narrows by actor', async () => {
    const growth = teamIdBySlug('growth');
    teams.updateTeam(danaActor(), growth, { name: 'Growth Core' });
    teams.updateMemberRole(danaActor(), growth, miraActor().id, 'ADMIN');
    const { user } = await openActivity(danaActor().id, 'growth');

    await user.selectOptions(screen.getByLabelText('Actor'), danaActor().id);

    expect(table().getAllByText('Dana Diaz (dana@example.com)').length).toBeGreaterThan(0);
  });

  it('offers only the accounts that acted on this team', async () => {
    await openActivity(adminActor().id);

    const options = within(screen.getByLabelText('Actor')).getAllByRole('option');

    expect(options.map((option) => option.textContent)).toEqual([
      'Anyone',
      'Avery Admin (admin@example.com)',
    ]);
  });

  it('says so when the filters match nothing, and offers a way back', async () => {
    const { user } = await openActivity(adminActor().id);

    await user.type(screen.getByLabelText('Search'), 'nothing-matches-this');
    expect(await screen.findByText('No entries match these filters.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it("exports this team's slice rather than the whole log", async () => {
    // jsdom implements neither object URLs nor navigation, so stand in for both and assert
    // on the document that would have been handed to the reader.
    const documents: string[] = [];
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => {
        void blob.text().then((text) => documents.push(text));
        return 'blob:activity';
      },
      revokeObjectURL: () => undefined,
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    teams.updateTeam(danaActor(), teamIdBySlug('growth'), { name: 'Growth Core' });

    const { user } = await openActivity(adminActor().id);
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      /Exported \d+ entries to team-activity.csv/,
    );
    await vi.waitFor(() => expect(documents[0]).toContain('Avery Admin (admin@example.com)'));
    expect(documents[0]).toContain('Timestamp,Action,Actor,Actor ID,Target type,Target,Details');
    expect(documents[0]).not.toContain('Growth Core');
  });

  it('reports a date range that ends before it starts rather than crashing', async () => {
    const { user } = await openActivity(adminActor().id);

    await user.type(screen.getByLabelText('From'), '2026-08-20');
    await user.type(screen.getByLabelText('To'), '2026-08-10');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The start of the range must not be after its end',
    );
  });
});
