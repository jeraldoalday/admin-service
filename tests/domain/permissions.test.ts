import { describe, expect, it } from 'vitest';
import { audit, permissions, teams } from '@/domain';
import { adminActor, danaActor, miraActor, rajActor, teamIdBySlug } from '../helpers';

describe('effective permissions', () => {
  it('gives OWNER and ADMIN every permission by default', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');

    const owner = permissions.getEffectivePermissions(admin, platform, admin.id);
    const teamAdmin = permissions.getEffectivePermissions(admin, platform, danaActor().id);

    expect(owner.rolePermissions).toHaveLength(5);
    expect(teamAdmin.rolePermissions).toHaveLength(5);
    expect(owner.grantedPermissions).toEqual([]);
  });

  it('gives MEMBER nothing by default, and only what has been granted', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');

    const raj = permissions.getEffectivePermissions(admin, platform, rajActor().id);

    expect(raj.role).toBe('MEMBER');
    expect(raj.rolePermissions).toEqual([]);
    expect(raj.grantedPermissions).toEqual(['MANAGE_INVITES']);
    expect(raj.effectivePermissions).toEqual(['MANAGE_INVITES']);
  });

  it('is additive — a grant never removes what the role already carries', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const dana = danaActor();

    const result = permissions.setMemberPermissionGrants(admin, platform, dana.id, ['MANAGE_TEAM']);

    expect(result.effectivePermissions).toHaveLength(5);
  });

  it('reads your own permissions without needing MANAGE_PERMISSIONS', () => {
    const platform = teamIdBySlug('platform');
    const raj = rajActor();

    expect(permissions.getOwnPermissions(raj, platform).effectivePermissions).toEqual([
      'MANAGE_INVITES',
    ]);
    expect(() => permissions.getEffectivePermissions(raj, platform, raj.id)).toThrow(
      'You do not have permission to perform this action',
    );
  });
});

describe('granting permissions', () => {
  it('replaces the previous grants wholesale and records the change', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const raj = rajActor();

    const result = permissions.setMemberPermissionGrants(admin, platform, raj.id, [
      'MANAGE_API_KEYS',
      'MANAGE_API_KEYS',
    ]);

    expect(result.grantedPermissions).toEqual(['MANAGE_API_KEYS']);
    expect(permissions.getEffectivePermissions(admin, platform, raj.id).grantedPermissions).toEqual(
      ['MANAGE_API_KEYS'],
    );
    // The seed already carries one such entry, so assert on the newest rather than the count.
    expect(
      audit.listAuditLogs(adminActor(), { action: 'team.member.permissions_updated' }).items[0],
    ).toMatchObject({ actorId: admin.id, metadata: { permissions: ['MANAGE_API_KEYS'] } });
  });

  it('lets a granted member act without promoting their team role', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const raj = rajActor();

    expect(() => teams.updateTeam(raj, platform, { name: 'Platform Core' })).toThrow(
      'You do not have permission to perform this action',
    );

    permissions.setMemberPermissionGrants(admin, platform, raj.id, ['MANAGE_TEAM']);

    expect(teams.updateTeam(raj, platform, { name: 'Platform Core' }).name).toBe('Platform Core');
    expect(teams.getTeam(raj, platform).role).toBe('MEMBER');
  });

  it('clears grants to remove access again', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const raj = rajActor();

    permissions.setMemberPermissionGrants(admin, platform, raj.id, []);

    expect(() => teams.listInvites(raj, platform)).toThrow(
      'You do not have permission to perform this action',
    );
  });

  it('is refused for a member who cannot manage permissions', () => {
    const growth = teamIdBySlug('growth');
    expect(() =>
      permissions.setMemberPermissionGrants(miraActor(), growth, miraActor().id, ['MANAGE_TEAM']),
    ).toThrow('You do not have permission to perform this action');
  });

  it('rejects an unknown permission name', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');

    expect(() =>
      permissions.setMemberPermissionGrants(admin, platform, rajActor().id, [
        'MANAGE_EVERYTHING' as 'MANAGE_TEAM',
      ]),
    ).toThrow();
  });

  it('reports a non-member target as not found', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');

    expect(() => permissions.getEffectivePermissions(admin, platform, miraActor().id)).toThrow(
      'Team member not found',
    );
  });

  it('refuses to grant a permission the caller does not hold themselves', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const raj = rajActor();

    // MANAGE_PERMISSIONS alone is not enough to grant MANAGE_MEMBERS — the same shape of guard
    // as MANAGE_MEMBERS alone not being enough to promote someone to OWNER.
    permissions.setMemberPermissionGrants(admin, platform, raj.id, ['MANAGE_PERMISSIONS']);

    expect(() =>
      permissions.setMemberPermissionGrants(raj, platform, raj.id, [
        'MANAGE_PERMISSIONS',
        'MANAGE_MEMBERS',
      ]),
    ).toThrow('You cannot grant a permission you do not hold yourself: MANAGE_MEMBERS');

    expect(permissions.getOwnPermissions(raj, platform).grantedPermissions).toEqual([
      'MANAGE_PERMISSIONS',
    ]);
  });

  it('lets a limited grantor keep or remove a permission they do not hold, once someone else granted it', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const raj = rajActor();

    // Admin (who holds everything) grants raj a permission raj could never have granted alone.
    permissions.setMemberPermissionGrants(admin, platform, raj.id, [
      'MANAGE_PERMISSIONS',
      'MANAGE_MEMBERS',
    ]);

    // Raj, now holding MANAGE_PERMISSIONS, can resubmit the same set unchanged...
    expect(
      permissions.setMemberPermissionGrants(raj, platform, raj.id, [
        'MANAGE_PERMISSIONS',
        'MANAGE_MEMBERS',
      ]).grantedPermissions,
    ).toEqual(['MANAGE_PERMISSIONS', 'MANAGE_MEMBERS']);

    // ...or drop the one they do not hold themselves, but cannot add it back once it is gone.
    permissions.setMemberPermissionGrants(raj, platform, raj.id, ['MANAGE_PERMISSIONS']);
    expect(() =>
      permissions.setMemberPermissionGrants(raj, platform, raj.id, [
        'MANAGE_PERMISSIONS',
        'MANAGE_MEMBERS',
      ]),
    ).toThrow('You cannot grant a permission you do not hold yourself: MANAGE_MEMBERS');
  });
});
