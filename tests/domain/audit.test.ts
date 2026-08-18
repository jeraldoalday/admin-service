import { describe, expect, it } from 'vitest';
import { audit, teams, users } from '@/domain';
import { adminActor, danaActor, teamIdBySlug } from '../helpers';

describe('the audit log', () => {
  it('records every mutation, newest first', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');

    teams.updateTeam(admin, platform, { name: 'Platform Core' });
    users.updateUser(admin, danaActor().id, { displayName: 'Dana D.' });

    const recent = audit.listAuditLogs({ pageSize: 2 }).items;
    expect(recent.map((entry) => entry.action)).toEqual(['user.updated', 'team.updated']);
  });

  it('captures who acted, on what, and with which change', () => {
    const admin = adminActor();
    teams.updateTeam(admin, teamIdBySlug('platform'), { name: 'Renamed' });

    expect(audit.listAuditLogs({ action: 'team.updated' }).items[0]).toMatchObject({
      actorId: admin.id,
      targetType: 'team',
      metadata: { name: 'Renamed' },
    });
  });

  it('filters by action and by target type', () => {
    const admin = adminActor();
    users.updateUser(admin, danaActor().id, { displayName: 'Dana D.' });

    expect(audit.listAuditLogs({ action: 'user.updated' }).total).toBe(2);
    expect(audit.listAuditLogs({ targetType: 'team' }).total).toBe(1);
    expect(audit.listAuditLogs({ action: 'nothing.happened' }).total).toBe(0);
  });

  it('paginates', () => {
    const page = audit.listAuditLogs({ page: 2, pageSize: 2 });

    expect(page.page).toBe(2);
    expect(page.items).toHaveLength(2);
    expect(page.totalPages).toBe(2);
  });

  it('lists every matching entry unpaginated, past the page-size cap', () => {
    // A page tops out at a hundred rows, which is exactly the trap an export falls into: it
    // reports success while quietly leaving the rest of the matching entries behind.
    for (let index = 0; index < 120; index += 1) {
      audit.recordAuditLog({ actorId: null, action: 'bulk.tested', targetType: 'test' });
    }

    expect(audit.listAuditLogs({ action: 'bulk.tested', pageSize: 100 }).items).toHaveLength(100);
    expect(audit.listAllAuditLogs({ action: 'bulk.tested' })).toHaveLength(120);
  });

  it('applies the same filters to the unpaginated read as to a page', () => {
    const admin = adminActor();
    teams.updateTeam(admin, teamIdBySlug('platform'), { name: 'Renamed' });

    expect(audit.listAllAuditLogs({ targetType: 'team' })).toHaveLength(2);
    expect(audit.listAllAuditLogs({ action: 'team.updated' })).toHaveLength(1);
    expect(audit.listAllAuditLogs()).toHaveLength(audit.listAuditLogs({ pageSize: 100 }).total);
  });

  it('offers the distinct actions and target types present, for filter menus', () => {
    expect(audit.listAuditActions()).toEqual([
      'api_key.created',
      'team.created',
      'team.member.permissions_updated',
      'user.updated',
    ]);
    expect(audit.listAuditTargetTypes()).toEqual(['api_key', 'team', 'team_membership', 'user']);
  });
});
