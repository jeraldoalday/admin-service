import { describe, expect, it } from 'vitest';
import { audit, getDatabase, teams } from '@/domain';
import {
  adminActor,
  createUser,
  danaActor,
  grant,
  miraActor,
  rajActor,
  teamIdBySlug,
} from '../helpers';

describe('creating a team', () => {
  it('makes the creator its owner', () => {
    const mira = miraActor();
    const team = teams.createTeam(mira, { name: 'Support' });

    expect(team.role).toBe('OWNER');
    expect(team.slug).toBe('support');
    expect(teams.listTeamMembers(mira, team.id).items[0]?.userId).toBe(mira.id);
  });

  it('derives a slug and disambiguates one that is taken', () => {
    const mira = miraActor();
    const first = teams.createTeam(mira, { name: 'Field Ops!' });
    const second = teams.createTeam(mira, { name: 'field ops' });

    expect(first.slug).toBe('field-ops');
    expect(second.slug).toMatch(/^field-ops-[0-9a-f]{6}$/);
  });

  it('rejects a blank name', () => {
    expect(() => teams.createTeam(miraActor(), { name: '   ' })).toThrow();
  });
});

describe('team visibility', () => {
  it('lists only the teams you belong to', () => {
    expect(teams.listTeamsForUser(adminActor()).total).toBe(1);
    expect(teams.listTeamsForUser(danaActor()).total).toBe(2);
  });

  it('hides a team you are not a member of behind a 404', () => {
    const growth = teamIdBySlug('growth');
    expect(() => teams.getTeam(adminActor(), growth)).toThrow('Team not found');
  });
});

describe('member roles', () => {
  it('lets a manager change a role', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const raj = rajActor();

    const updated = teams.updateMemberRole(admin, platform, raj.id, 'ADMIN');

    expect(updated.role).toBe('ADMIN');
    expect(audit.listAuditLogs({ action: 'team.member.role_updated' }).total).toBe(1);
  });

  it('refuses a plain member without the permission', () => {
    const platform = teamIdBySlug('platform');
    expect(() => teams.updateMemberRole(rajActor(), platform, adminActor().id, 'MEMBER')).toThrow(
      'You do not have permission to perform this action',
    );
  });

  it('refuses to hand out ownership to anyone but an owner', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const raj = rajActor();

    // Raj is a plain member who has been granted the roster permission. That is enough to
    // change roles, and must not be enough to decide who the team belongs to.
    grant(admin, platform, raj.id, ['MANAGE_MEMBERS']);

    expect(() => teams.updateMemberRole(raj, platform, raj.id, 'OWNER')).toThrow(
      'Only an owner can make someone else an owner',
    );
    expect(() => teams.updateMemberRole(raj, platform, danaActor().id, 'OWNER')).toThrow(
      'Only an owner can make someone else an owner',
    );
    expect(
      teams.listTeamMembers(admin, platform).items.filter((m) => m.role === 'OWNER'),
    ).toHaveLength(1);
  });

  it('lets a team admin manage the roster without touching ownership', () => {
    const dana = danaActor();
    const platform = teamIdBySlug('platform');

    // Dana is an ADMIN on Platform: promoting a member to ADMIN is hers to do.
    expect(teams.updateMemberRole(dana, platform, rajActor().id, 'ADMIN').role).toBe('ADMIN');
    expect(() => teams.updateMemberRole(dana, platform, dana.id, 'OWNER')).toThrow(
      'Only an owner can make someone else an owner',
    );
  });

  it('keeps at least one owner on the team', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');

    expect(() => teams.updateMemberRole(admin, platform, admin.id, 'ADMIN')).toThrow(
      'A team must have at least one owner',
    );
    expect(() => teams.removeMember(admin, platform, admin.id)).toThrow(
      'A team must have at least one owner',
    );
    expect(() => teams.leaveTeam(admin, platform)).toThrow(
      'The last owner cannot leave the team; transfer ownership or delete the team first',
    );
  });

  it('allows the previous owner to step down once a second owner exists', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const dana = danaActor();

    teams.updateMemberRole(admin, platform, dana.id, 'OWNER');

    expect(() => teams.leaveTeam(admin, platform)).not.toThrow();
    expect(teams.listTeamsForUser(admin).total).toBe(0);
  });
});

describe('removing a member', () => {
  it('clears their permission grants so a re-invite starts clean', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const raj = rajActor();

    expect(getDatabase().permissionGrants).toHaveLength(1);
    teams.removeMember(admin, platform, raj.id);

    expect(getDatabase().permissionGrants).toHaveLength(0);
    expect(teams.listTeamMembers(admin, platform).total).toBe(2);
  });

  it('reports an unknown member as not found', () => {
    expect(() => teams.removeMember(adminActor(), teamIdBySlug('platform'), 'nope')).toThrow(
      'Team member not found',
    );
  });
});

describe('invites', () => {
  it('issues a pending invite with a token and an expiry', () => {
    const invite = teams.createInvite(adminActor(), teamIdBySlug('platform'), {
      email: 'New.Hire@Example.com',
      role: 'MEMBER',
    });

    expect(invite.email).toBe('new.hire@example.com');
    expect(invite.status).toBe('PENDING');
    expect(invite.token).toHaveLength(48);
    expect(Date.parse(invite.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('cannot invite an existing member or duplicate a pending invite', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');

    expect(() => teams.createInvite(admin, platform, { email: 'raj@example.com' })).toThrow(
      'This person is already a member of the team',
    );
    expect(() => teams.createInvite(admin, platform, { email: 'noor@example.com' })).toThrow(
      'There is already a pending invite for this email',
    );
  });

  it('never issues an invite for the OWNER role', () => {
    expect(() =>
      teams.createInvite(adminActor(), teamIdBySlug('platform'), {
        email: 'someone@example.com',
        // The domain rejects this at the schema, which is why the cast is needed to express it.
        role: 'OWNER' as 'ADMIN',
      }),
    ).toThrow();
  });

  it('is accepted only by the account it was addressed to', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const invitee = createUser('joiner@example.com', 'Joiner');
    const invite = teams.createInvite(admin, platform, { email: 'joiner@example.com' });

    expect(() => teams.acceptInvite(miraActor(), invite.token)).toThrow(
      'This invite was issued to a different email address',
    );

    const joined = teams.acceptInvite(invitee, invite.token);
    expect(joined.role).toBe('MEMBER');
    expect(teams.listTeamMembers(admin, platform).total).toBe(4);
    expect(teams.listInvites(admin, platform, { status: 'ACCEPTED' }).total).toBe(1);
  });

  it('cannot be accepted twice', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const invitee = createUser('twice@example.com', 'Twice');
    const invite = teams.createInvite(admin, platform, { email: 'twice@example.com' });

    teams.acceptInvite(invitee, invite.token);
    expect(() => teams.acceptInvite(invitee, invite.token)).toThrow(
      'This invite is no longer valid',
    );
  });

  it('flips an aged-out invite to EXPIRED when it is presented', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const invitee = createUser('late@example.com', 'Late');
    const invite = teams.createInvite(admin, platform, { email: 'late@example.com' });

    // Age the invite past its seven-day window without waiting for it.
    const stored = getDatabase().invites.find((candidate) => candidate.id === invite.id);
    if (stored) stored.expiresAt = new Date(Date.now() - 1000).toISOString();

    expect(() => teams.acceptInvite(invitee, invite.token)).toThrow('This invite has expired');
    expect(teams.listInvites(admin, platform, { status: 'EXPIRED' }).total).toBe(1);
  });

  it('reads as expired the moment its window closes, without waiting to be presented', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const invite = teams.createInvite(admin, platform, { email: 'stale@example.com' });

    const stored = getDatabase().invites.find((candidate) => candidate.id === invite.id);
    if (stored) stored.expiresAt = new Date(Date.now() - 1000).toISOString();

    const listed = teams.listInvites(admin, platform).items.find((row) => row.id === invite.id);
    expect(listed?.status).toBe('EXPIRED');
    expect(teams.findInviteByToken(invite.token)?.status).toBe('EXPIRED');
  });

  it('leaves an aged-out invite out of the pending filter and inside the expired one', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const invite = teams.createInvite(admin, platform, { email: 'stale@example.com' });

    const stored = getDatabase().invites.find((candidate) => candidate.id === invite.id);
    if (stored) stored.expiresAt = new Date(Date.now() - 1000).toISOString();

    const pending = teams.listInvites(admin, platform, { status: 'PENDING' }).items;
    const expired = teams.listInvites(admin, platform, { status: 'EXPIRED' }).items;

    expect(pending.map((row) => row.id)).not.toContain(invite.id);
    expect(expired.map((row) => row.id)).toContain(invite.id);
  });

  it('refuses to revoke an invite that has already aged out', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const invite = teams.createInvite(admin, platform, { email: 'stale@example.com' });

    const stored = getDatabase().invites.find((candidate) => candidate.id === invite.id);
    if (stored) stored.expiresAt = new Date(Date.now() - 1000).toISOString();

    // Revoking would overwrite a true EXPIRED with a REVOKED that nobody decided on, and
    // would write an audit entry recording that decision.
    expect(() => teams.revokeInvite(admin, platform, invite.id)).toThrow(
      'This invite has already expired',
    );
    expect(getDatabase().invites.find((row) => row.id === invite.id)?.status).toBe('EXPIRED');
    expect(audit.listAuditLogs({ action: 'team.invite.revoked' }).total).toBe(0);
  });

  it('revokes only pending invites', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const pending = teams.listInvites(admin, platform, { status: 'PENDING' }).items[0];

    teams.revokeInvite(admin, platform, pending?.id ?? '');
    expect(teams.listInvites(admin, platform, { status: 'REVOKED' }).total).toBe(1);
    expect(() => teams.revokeInvite(admin, platform, pending?.id ?? '')).toThrow(
      'Only pending invites can be revoked',
    );
  });

  it('is managed by a plain member holding MANAGE_INVITES', () => {
    const platform = teamIdBySlug('platform');
    const raj = rajActor();

    expect(teams.listInvites(raj, platform).total).toBe(1);
    expect(() => teams.createInvite(raj, platform, { email: 'granted@example.com' })).not.toThrow();
  });

  it('is refused for a member without the permission', () => {
    const growth = teamIdBySlug('growth');
    expect(() => teams.listInvites(miraActor(), growth)).toThrow(
      'You do not have permission to perform this action',
    );
  });
});

describe('deleting a team', () => {
  it('is owner-only and takes its dependents with it', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');

    expect(() => teams.deleteTeam(danaActor(), platform)).toThrow(
      'You do not have permission to perform this action',
    );

    teams.deleteTeam(admin, platform);

    const db = getDatabase();
    expect(db.teams).toHaveLength(1);
    expect(db.memberships.filter((m) => m.teamId === platform)).toHaveLength(0);
    expect(db.invites.filter((i) => i.teamId === platform)).toHaveLength(0);
    expect(db.permissionGrants.filter((g) => g.teamId === platform)).toHaveLength(0);
    expect(db.apiKeys.filter((k) => k.teamId === platform)).toHaveLength(0);
    expect(audit.listAuditLogs({ action: 'team.deleted' }).total).toBe(1);
  });
});
