import { describe, expect, it } from 'vitest';
import { apiKeys, audit, permissions, teams, users } from '@/domain';
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

describe('filtering the log by actor', () => {
  it('narrows the log to one person', () => {
    const admin = adminActor();
    const dana = danaActor();
    teams.updateTeam(admin, teamIdBySlug('platform'), { name: 'Platform Core' });
    teams.updateTeam(dana, teamIdBySlug('growth'), { name: 'Growth Core' });

    const byDana = audit.listAuditLogs({ actorId: dana.id });

    expect(byDana.total).toBe(1);
    expect(byDana.items[0]?.metadata).toEqual({ name: 'Growth Core' });
  });

  it('lists the accounts that appear in the log, labelled by name and email', () => {
    const options = audit.listAuditActors();

    expect(options).toEqual([{ id: adminActor().id, label: 'Avery Admin (admin@example.com)' }]);
  });

  it('keeps an entry reachable by the id of an account that has since been deleted', () => {
    const admin = adminActor();
    const departing = createUser('departing@example.com', 'Dee Parting');
    teams.createTeam(departing, { name: 'Short Lived' });
    users.deleteUser(admin, departing.id);

    const options = audit.listAuditActors();
    const orphaned = options.find((option) => option.id === departing.id);

    expect(orphaned?.label).toBe(departing.id);
    expect(audit.listAuditLogs({ actorId: departing.id }).total).toBeGreaterThan(0);
  });
});

describe('searching the log', () => {
  it('matches the metadata, which is where the interesting detail lives', () => {
    teams.createInvite(adminActor(), teamIdBySlug('platform'), { email: 'noor2@example.com' });

    const found = audit.listAuditLogs({ search: 'noor2@example.com' });

    expect(found.total).toBe(1);
    expect(found.items[0]?.action).toBe('team.invite.created');
  });

  it('matches the action and the target type as well', () => {
    expect(audit.listAuditLogs({ search: 'api_key' }).total).toBe(1);
    expect(audit.listAuditLogs({ search: 'team_membership' }).total).toBe(1);
  });

  it('ignores case', () => {
    teams.updateTeam(adminActor(), teamIdBySlug('platform'), { name: 'Platform Core' });

    expect(audit.listAuditLogs({ search: 'PLATFORM CORE' }).total).toBe(1);
  });

  it('combines with the other filters rather than replacing them', () => {
    const admin = adminActor();
    teams.updateTeam(admin, teamIdBySlug('platform'), { name: 'Shared Word' });
    users.updateUser(admin, danaActor().id, { displayName: 'Shared Word' });

    expect(audit.listAuditLogs({ search: 'shared word' }).total).toBe(2);
    expect(audit.listAuditLogs({ search: 'shared word', targetType: 'team' }).total).toBe(1);
  });

  it('reaches every match through the unpaginated read an export uses', () => {
    for (let index = 0; index < 120; index += 1) {
      audit.recordAuditLog({
        actorId: null,
        action: 'bulk.tested',
        targetType: 'test',
        metadata: { needle: 'findme' },
      });
    }

    expect(audit.listAllAuditLogs({ search: 'findme' })).toHaveLength(120);
  });
});

describe("a team's own activity", () => {
  it('carries only the entries belonging to that team', () => {
    const admin = adminActor();
    const dana = danaActor();
    const platform = teamIdBySlug('platform');
    teams.updateTeam(dana, teamIdBySlug('growth'), { name: 'Growth Core' });
    teams.updateTeam(admin, platform, { name: 'Platform Core' });

    const activity = audit.listTeamActivity(admin, platform);

    expect(activity.total).toBeGreaterThan(0);
    expect(activity.items.every((entry) => entry.teamId === platform)).toBe(true);
    expect(activity.items.map((entry) => entry.metadata)).not.toContainEqual({
      name: 'Growth Core',
    });
  });

  it('leaves platform-level entries out entirely', () => {
    const admin = adminActor();
    users.updateUser(admin, danaActor().id, { displayName: 'Dana D.' });

    const actions = audit
      .listTeamActivity(admin, teamIdBySlug('platform'))
      .items.map((entry) => entry.action);

    expect(actions).not.toContain('user.updated');
  });

  it('covers memberships, invites, grants, and keys alike', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const newcomer = createUser('newcomer@example.com', 'New Comer');

    joinTeam(admin, platform, newcomer, 'newcomer@example.com');
    permissions.setMemberPermissionGrants(admin, platform, rajActor().id, ['MANAGE_INVITES']);
    apiKeys.createApiKey(admin, platform, { name: 'deploy', permissions: [] });

    const actions = audit.listTeamActivity(admin, platform).items.map((entry) => entry.action);

    expect(actions).toEqual(
      expect.arrayContaining([
        'api_key.created',
        'team.member.permissions_updated',
        'team.invite.accepted',
        'team.invite.created',
      ]),
    );
  });

  it('is refused for a member who does not hold MANAGE_TEAM', () => {
    expect(() => audit.listTeamActivity(rajActor(), teamIdBySlug('platform'))).toThrow(
      'You do not have permission to perform this action',
    );
  });

  it('opens to a plain member once MANAGE_TEAM is granted', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    grant(admin, platform, rajActor().id, ['MANAGE_TEAM']);

    expect(audit.listTeamActivity(rajActor(), platform).total).toBeGreaterThan(0);
  });

  it('hides a team the caller does not belong to behind a not-found', () => {
    expect(() => audit.listTeamActivity(adminActor(), teamIdBySlug('growth'))).toThrow(
      'Team not found',
    );
  });

  it('cannot be widened to another team by passing that team as a filter', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');

    const smuggled = audit.listTeamActivity(admin, platform, { teamId: teamIdBySlug('growth') });

    expect(smuggled.total).toBe(0);
  });

  it('applies the same filters the platform log takes', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    apiKeys.createApiKey(admin, platform, { name: 'deploy', permissions: [] });

    expect(audit.listTeamActivity(admin, platform, { action: 'api_key.created' }).total).toBe(2);
    expect(audit.listTeamActivity(admin, platform, { search: 'deploy' }).total).toBe(1);
    expect(audit.listTeamActivity(admin, platform, { actorId: danaActor().id }).total).toBe(0);
  });

  it('exports every match rather than a page of them', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');

    for (let index = 0; index < 30; index += 1) {
      apiKeys.createApiKey(admin, platform, { name: `key-${index}`, permissions: [] });
    }

    expect(audit.listTeamActivity(admin, platform).items).toHaveLength(20);
    expect(audit.listAllTeamActivity(admin, platform).length).toBeGreaterThan(30);
  });

  it('lists only the accounts that acted on this team', () => {
    const growth = teamIdBySlug('growth');
    teams.updateTeam(danaActor(), growth, { name: 'Growth Core' });
    teams.updateMemberRole(danaActor(), growth, miraActor().id, 'ADMIN');

    const actors = audit.listTeamActivityActors(danaActor(), growth);

    expect(actors).toEqual([{ id: danaActor().id, label: 'Dana Diaz (dana@example.com)' }]);
  });

  it('offers the actions present in this team and no others', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    teams.updateTeam(danaActor(), teamIdBySlug('growth'), { name: 'Growth Core' });

    expect(audit.listTeamActivityActions(admin, platform)).toEqual([
      'api_key.created',
      'team.created',
      'team.member.permissions_updated',
    ]);
  });

  it('offers the target types present in this team and no others', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    teams.updateTeam(danaActor(), teamIdBySlug('growth'), { name: 'Growth Core' });

    expect(audit.listTeamActivityTargetTypes(admin, platform)).toEqual([
      'api_key',
      'team',
      'team_membership',
    ]);
  });

  it('narrows a team activity read by target type', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    apiKeys.createApiKey(admin, platform, { name: 'deploy', permissions: [] });

    const activity = audit.listTeamActivity(admin, platform, { targetType: 'api_key' });

    expect(activity.items.every((entry) => entry.targetType === 'api_key')).toBe(true);
    expect(activity.total).toBeGreaterThan(0);
  });

  it('refuses the actor, action, and target type lists to a member without MANAGE_TEAM', () => {
    const platform = teamIdBySlug('platform');

    expect(() => audit.listTeamActivityActors(rajActor(), platform)).toThrow(
      'You do not have permission to perform this action',
    );
    expect(() => audit.listTeamActivityActions(rajActor(), platform)).toThrow(
      'You do not have permission to perform this action',
    );
    expect(() => audit.listTeamActivityTargetTypes(rajActor(), platform)).toThrow(
      'You do not have permission to perform this action',
    );
  });
});
