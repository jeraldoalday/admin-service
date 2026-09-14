import { describe, expect, it } from 'vitest';
import { audit, teams, users } from '@/domain';
import { adminActor, danaActor, rajActor, teamIdBySlug } from '../helpers';

describe('the audit log', () => {
  it('records every mutation, newest first', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');

    teams.updateTeam(admin, platform, { name: 'Platform Core' });
    users.updateUser(admin, danaActor().id, { displayName: 'Dana D.' });

    const recent = audit.listAuditLogs(adminActor(), { pageSize: 2 }).items;
    expect(recent.map((entry) => entry.action)).toEqual(['user.updated', 'team.updated']);
  });

  it('captures who acted, on what, and with which change', () => {
    const admin = adminActor();
    teams.updateTeam(admin, teamIdBySlug('platform'), { name: 'Renamed' });

    expect(audit.listAuditLogs(adminActor(), { action: 'team.updated' }).items[0]).toMatchObject({
      actorId: admin.id,
      targetType: 'team',
      metadata: { name: 'Renamed' },
    });
  });

  it('filters by action and by target type', () => {
    const admin = adminActor();
    users.updateUser(admin, danaActor().id, { displayName: 'Dana D.' });

    expect(audit.listAuditLogs(adminActor(), { action: 'user.updated' }).total).toBe(2);
    expect(audit.listAuditLogs(adminActor(), { targetType: 'team' }).total).toBe(1);
    expect(audit.listAuditLogs(adminActor(), { action: 'nothing.happened' }).total).toBe(0);
  });

  it('paginates', () => {
    const page = audit.listAuditLogs(adminActor(), { page: 2, pageSize: 2 });

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

    expect(
      audit.listAuditLogs(adminActor(), { action: 'bulk.tested', pageSize: 100 }).items,
    ).toHaveLength(100);
    expect(audit.listAllAuditLogs(adminActor(), { action: 'bulk.tested' })).toHaveLength(120);
  });

  it('applies the same filters to the unpaginated read as to a page', () => {
    const admin = adminActor();
    teams.updateTeam(admin, teamIdBySlug('platform'), { name: 'Renamed' });

    expect(audit.listAllAuditLogs(adminActor(), { targetType: 'team' })).toHaveLength(2);
    expect(audit.listAllAuditLogs(adminActor(), { action: 'team.updated' })).toHaveLength(1);
    expect(audit.listAllAuditLogs(adminActor())).toHaveLength(
      audit.listAuditLogs(adminActor(), { pageSize: 100 }).total,
    );
  });

  it('filters by a date range, counting a bare date as the whole day it names', () => {
    const admin = adminActor();
    teams.updateTeam(admin, teamIdBySlug('platform'), { name: 'Renamed' });

    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // The entry was just written, so a range ending today has to include it — which it only
    // does if the boundary covers the whole day rather than the instant it starts.
    expect(audit.listAuditLogs(adminActor(), { from: today, to: today }).total).toBe(1);
    expect(audit.listAuditLogs(adminActor(), { from: yesterday }).total).toBe(1);
    expect(audit.listAuditLogs(adminActor(), { to: yesterday }).total).toBe(4); // the seeded backdated entries
    expect(audit.listAuditLogs(adminActor(), { from: tomorrow }).total).toBe(0);
  });

  it('combines a date range with the other filters', () => {
    const admin = adminActor();
    teams.updateTeam(admin, teamIdBySlug('platform'), { name: 'Renamed' });
    users.updateUser(admin, danaActor().id, { displayName: 'Dana D.' });

    const today = new Date().toISOString().slice(0, 10);

    expect(audit.listAuditLogs(adminActor(), { from: today, action: 'team.updated' }).total).toBe(
      1,
    );
    expect(audit.listAllAuditLogs(adminActor(), { from: today })).toHaveLength(2);
  });

  it('refuses a range that ends before it starts, and a date it cannot read', () => {
    expect(() =>
      audit.listAuditLogs(adminActor(), { from: '2026-08-19', to: '2026-08-18' }),
    ).toThrow('The start of the range must not be after its end');
    expect(() => audit.listAuditLogs(adminActor(), { from: 'last tuesday' })).toThrow(
      'must be a valid date',
    );
  });

  it('offers the distinct actions and target types present, for filter menus', () => {
    expect(audit.listAuditActions(adminActor())).toEqual([
      'api_key.created',
      'team.created',
      'team.member.permissions_updated',
      'user.updated',
    ]);
    expect(audit.listAuditTargetTypes(adminActor())).toEqual([
      'api_key',
      'team',
      'team_membership',
      'user',
    ]);
  });

  // The platform log is admin-only, and the domain layer has to say so on its own rather than
  // trusting the route guard that keeps a plain member from reaching the screen at all — a
  // caller that reaches these functions some other way must still be refused here.
  describe('is refused for a non-admin', () => {
    it('on every platform-wide read', () => {
      const raj = rajActor();
      const denied = 'You do not have permission to perform this action';

      expect(() => audit.listAuditLogs(raj)).toThrow(denied);
      expect(() => audit.listAllAuditLogs(raj)).toThrow(denied);
      expect(() => audit.listAuditActions(raj)).toThrow(denied);
      expect(() => audit.listAuditTargetTypes(raj)).toThrow(denied);
      expect(() => audit.listAuditTeams(raj)).toThrow(denied);
      expect(() => audit.listAuditActors(raj)).toThrow(denied);
    });
  });
});
