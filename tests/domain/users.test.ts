import { describe, expect, it } from 'vitest';
import { apiKeys, audit, getDatabase, teams, users } from '@/domain';
import { adminActor, createUser, danaActor, joinTeam, miraActor, teamIdBySlug } from '../helpers';

describe('listing users', () => {
  it('is refused for non-admins', () => {
    expect(() => users.listUsers(danaActor())).toThrow(
      'You do not have permission to perform this action',
    );
  });

  it('returns every account newest first', () => {
    const result = users.listUsers(adminActor());

    expect(result.total).toBe(5);
    expect(result.items[0]?.email).toBe('sam@example.com');
    expect(result.items.at(-1)?.email).toBe('admin@example.com');
  });

  it('filters by role, status, and search independently', () => {
    const admin = adminActor();

    expect(users.listUsers(admin, { role: 'ADMIN' }).total).toBe(1);
    expect(users.listUsers(admin, { isActive: false }).total).toBe(1);
    expect(users.listUsers(admin, { search: 'raj' }).items[0]?.displayName).toBe('Raj Patel');
    expect(users.listUsers(admin, { search: 'OKAFOR' }).total).toBe(1);
    expect(users.listUsers(admin, { role: 'ADMIN', isActive: false }).total).toBe(0);
  });

  it('paginates and reports the page count', () => {
    const firstPage = users.listUsers(adminActor(), { page: 1, pageSize: 2 });

    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.total).toBe(5);
    expect(firstPage.totalPages).toBe(3);
  });
});

describe('listing every matching user', () => {
  it('is refused for non-admins', () => {
    expect(() => users.listAllUsers(danaActor())).toThrow(
      'You do not have permission to perform this action',
    );
  });

  it('returns every match rather than a page of them', () => {
    const admin = adminActor();
    for (let index = 0; index < 25; index += 1) {
      createUser(`bulk${index}@example.com`, `Bulk ${index}`);
    }

    expect(users.listUsers(admin, { pageSize: 10 }).items).toHaveLength(10);
    expect(users.listAllUsers(admin)).toHaveLength(30);
  });

  it('applies the same filters as the paged read', () => {
    const admin = adminActor();

    expect(users.listAllUsers(admin, { role: 'ADMIN' })).toHaveLength(1);
    expect(users.listAllUsers(admin, { isActive: false })).toHaveLength(1);
    expect(users.listAllUsers(admin, { search: 'okafor' }).map((user) => user.email)).toEqual([
      'mira@example.com',
    ]);
  });

  it('carries no password material', () => {
    expect(JSON.stringify(users.listAllUsers(adminActor()))).not.toContain('passwordHash');
  });
});

describe('updating a user', () => {
  it('applies the change and writes an audit entry', () => {
    const admin = adminActor();
    const dana = danaActor();

    const updated = users.updateUser(admin, dana.id, { role: 'ADMIN', displayName: 'Dana D.' });

    expect(updated.role).toBe('ADMIN');
    expect(updated.displayName).toBe('Dana D.');
    expect(audit.listAuditLogs(adminActor(), { action: 'user.updated' }).items[0]).toMatchObject({
      actorId: admin.id,
      targetId: dana.id,
    });
  });

  it('refuses an empty patch', () => {
    expect(() => users.updateUser(adminActor(), danaActor().id, {})).toThrow(
      'At least one field must be provided',
    );
  });

  it('stops an admin from demoting or deactivating themselves', () => {
    const admin = adminActor();

    expect(() => users.updateUser(admin, admin.id, { role: 'MEMBER' })).toThrow(
      'Admins cannot change their own role or deactivate their own account',
    );
    expect(() => users.updateUser(admin, admin.id, { isActive: false })).toThrow(
      'Admins cannot change their own role or deactivate their own account',
    );
    // Renaming yourself is still fine — it cannot lock you out.
    expect(users.updateUser(admin, admin.id, { displayName: 'Avery A.' }).displayName).toBe(
      'Avery A.',
    );
  });

  it('reports a missing account as not found', () => {
    expect(() => users.updateUser(adminActor(), 'nope', { displayName: 'x' })).toThrow(
      'User not found',
    );
  });
});

describe('deleting a user', () => {
  it('removes their memberships and permission grants', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const raj = getDatabase().users.find((user) => user.email === 'raj@example.com');

    expect(teams.listTeamMembers(admin, platform).total).toBe(3);
    expect(getDatabase().permissionGrants).toHaveLength(1);

    users.deleteUser(admin, raj?.id ?? '');

    expect(teams.listTeamMembers(admin, platform).total).toBe(2);
    expect(getDatabase().permissionGrants).toHaveLength(0);
    expect(users.listUsers(admin).total).toBe(4);
  });

  it('hands a team the deleted account solely owned to the member left behind', () => {
    const admin = adminActor();
    const dana = danaActor();
    const growth = teamIdBySlug('growth');
    const mira = getDatabase().users.find((user) => user.email === 'mira@example.com');

    // Dana is the only OWNER of Growth, and Mira is the only other member.
    users.deleteUser(admin, dana.id);

    const membership = getDatabase().memberships.find(
      (candidate) => candidate.teamId === growth && candidate.userId === mira?.id,
    );
    expect(membership?.role).toBe('OWNER');
    expect(getDatabase().teams.some((team) => team.id === growth)).toBe(true);
  });

  it('prefers a team ADMIN over a longer-standing plain member', () => {
    const admin = adminActor();
    const growth = teamIdBySlug('growth');
    const dana = danaActor();
    const newcomer = createUser('newcomer@example.com', 'Newcomer');
    joinTeam(dana, growth, newcomer, 'newcomer@example.com');
    teams.updateMemberRole(dana, growth, newcomer.id, 'ADMIN');

    users.deleteUser(admin, dana.id);

    const promoted = getDatabase().memberships.find(
      (candidate) => candidate.teamId === growth && candidate.userId === newcomer.id,
    );
    expect(promoted?.role).toBe('OWNER');
  });

  it('deletes a team the account solely owned and nobody else was in', () => {
    const admin = adminActor();
    const mira = miraActor();
    const solo = teams.createTeam(mira, { name: 'Solo' });
    const key = apiKeys.createApiKey(mira, solo.id, { name: 'ci' });

    users.deleteUser(admin, mira.id);

    expect(getDatabase().teams.some((team) => team.id === solo.id)).toBe(false);
    expect(getDatabase().apiKeys.some((candidate) => candidate.id === key.apiKey.id)).toBe(false);
    expect(audit.listAllAuditLogs(adminActor(), { action: 'team.deleted' })).toHaveLength(1);
  });

  it('leaves a team alone when it still has another owner', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const dana = danaActor();
    teams.updateMemberRole(admin, platform, dana.id, 'OWNER');

    users.deleteUser(admin, dana.id);

    const remaining = getDatabase().memberships.filter(
      (candidate) => candidate.teamId === platform && candidate.role === 'OWNER',
    );
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.userId).toBe(admin.id);
  });

  it('stops an admin from deleting their own account', () => {
    const admin = adminActor();
    expect(() => users.deleteUser(admin, admin.id)).toThrow(
      'Admins cannot delete their own account',
    );
  });

  it('writes an audit entry', () => {
    const admin = adminActor();
    users.deleteUser(admin, danaActor().id);

    expect(audit.listAuditLogs(adminActor(), { action: 'user.deleted' }).total).toBe(1);
  });
});
