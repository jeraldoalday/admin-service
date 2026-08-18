import { describe, expect, it } from 'vitest';
import { audit, getDatabase, teams, users } from '@/domain';
import { adminActor, danaActor, teamIdBySlug } from '../helpers';

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

describe('updating a user', () => {
  it('applies the change and writes an audit entry', () => {
    const admin = adminActor();
    const dana = danaActor();

    const updated = users.updateUser(admin, dana.id, { role: 'ADMIN', displayName: 'Dana D.' });

    expect(updated.role).toBe('ADMIN');
    expect(updated.displayName).toBe('Dana D.');
    expect(audit.listAuditLogs({ action: 'user.updated' }).items[0]).toMatchObject({
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

  it('stops an admin from deleting their own account', () => {
    const admin = adminActor();
    expect(() => users.deleteUser(admin, admin.id)).toThrow(
      'Admins cannot delete their own account',
    );
  });

  it('writes an audit entry', () => {
    const admin = adminActor();
    users.deleteUser(admin, danaActor().id);

    expect(audit.listAuditLogs({ action: 'user.deleted' }).total).toBe(1);
  });
});
