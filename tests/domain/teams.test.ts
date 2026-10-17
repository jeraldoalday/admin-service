import { describe, expect, it } from 'vitest';
import { audit, getDatabase, teams } from '@/domain';
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
    expect(audit.listAuditLogs(adminActor(), { action: 'team.member.role_updated' }).total).toBe(1);
  });

  it('refuses a plain member without the permission', () => {
    const platform = teamIdBySlug('platform');
    expect(() => teams.updateMemberRole(rajActor(), platform, adminActor().id, 'MEMBER')).toThrow(
      'You do not have permission to perform this action',
    );
  });

  it('refuses to let an admin promote a member to owner', () => {
    const platform = teamIdBySlug('platform');
    const raj = rajActor();

    // Dana is a team ADMIN on Platform, which carries MANAGE_MEMBERS by default — but
    // promoting to OWNER is not something that permission should unlock on its own.
    expect(() => teams.updateMemberRole(danaActor(), platform, raj.id, 'OWNER')).toThrow(
      'Only an owner can promote a member to owner',
    );
    expect(
      teams.listTeamMembers(adminActor(), platform).items.find((member) => member.userId === raj.id)
        ?.role,
    ).toBe('MEMBER');
  });

  it('refuses to let a member promote someone to admin on a MANAGE_MEMBERS grant alone', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const raj = rajActor();
    const newcomer = createUser('newcomer@example.com');
    joinTeam(admin, platform, newcomer, 'newcomer@example.com');

    // Raj holds only MANAGE_MEMBERS, granted by the owner — the same shape of guard as
    // MANAGE_MEMBERS alone not being enough to promote someone to owner. ADMIN carries every
    // other grantable permission by default, so promoting to it is the same step up in power
    // as granting all five directly, and raj holds only one of them.
    grant(admin, platform, raj.id, ['MANAGE_MEMBERS']);

    expect(() => teams.updateMemberRole(raj, platform, newcomer.id, 'ADMIN')).toThrow(
      'You cannot promote a member to a role that carries a permission you do not hold yourself',
    );
    expect(
      teams.listTeamMembers(admin, platform).items.find((member) => member.userId === newcomer.id)
        ?.role,
    ).toBe('MEMBER');
  });

  it('lets a member who holds every permission promote someone to admin', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const raj = rajActor();
    const newcomer = createUser('newcomer2@example.com');
    joinTeam(admin, platform, newcomer, 'newcomer2@example.com');

    // Raj holds all five permissions as grants rather than through role, and ADMIN carries
    // nothing beyond those five — so this does not hand raj anything raj could not already do.
    grant(admin, platform, raj.id, [
      'MANAGE_TEAM',
      'MANAGE_MEMBERS',
      'MANAGE_INVITES',
      'MANAGE_PERMISSIONS',
      'MANAGE_API_KEYS',
    ]);

    const updated = teams.updateMemberRole(raj, platform, newcomer.id, 'ADMIN');

    expect(updated.role).toBe('ADMIN');
  });

  it('refuses to let an admin promote themselves to owner', () => {
    const platform = teamIdBySlug('platform');
    const dana = danaActor();

    expect(() => teams.updateMemberRole(dana, platform, dana.id, 'OWNER')).toThrow(
      'Only an owner can promote a member to owner',
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

  it('refuses to let a member demote a co-owner on a MANAGE_MEMBERS grant alone', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const dana = danaActor();
    const raj = rajActor();

    // Dana is promoted to a second owner, and raj is granted MANAGE_MEMBERS without ever
    // holding OWNER — the mirror of the fixture above that lets raj promote, but not to
    // OWNER. Stripping OWNER from someone is the same step up in power as handing it out.
    teams.updateMemberRole(admin, platform, dana.id, 'OWNER');
    grant(admin, platform, raj.id, ['MANAGE_MEMBERS']);

    expect(() => teams.updateMemberRole(raj, platform, dana.id, 'MEMBER')).toThrow(
      "Only an owner can change another owner's role",
    );
    expect(
      teams.listTeamMembers(admin, platform).items.find((member) => member.userId === dana.id)
        ?.role,
    ).toBe('OWNER');
  });

  it('lets an owner demote a co-owner', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const dana = danaActor();

    teams.updateMemberRole(admin, platform, dana.id, 'OWNER');

    expect(() => teams.updateMemberRole(admin, platform, dana.id, 'ADMIN')).not.toThrow();
  });

  it('refuses to let a member demote a co-admin on a MANAGE_MEMBERS grant alone', () => {
    const platform = teamIdBySlug('platform');
    const dana = danaActor();
    const raj = rajActor();

    // Dana is already a team ADMIN on Platform (from the seed), and raj is granted
    // MANAGE_MEMBERS without ever holding every permission ADMIN carries — the mirror of the
    // guard around promoting someone into ADMIN. Stripping an admin's power is the same step
    // up as handing it out.
    grant(adminActor(), platform, raj.id, ['MANAGE_MEMBERS']);

    expect(() => teams.updateMemberRole(raj, platform, dana.id, 'MEMBER')).toThrow(
      'You cannot change the role of an admin while missing a permission they hold by default',
    );
    expect(
      teams
        .listTeamMembers(adminActor(), platform)
        .items.find((member) => member.userId === dana.id)?.role,
    ).toBe('ADMIN');
  });

  it('lets a member who holds every permission demote a co-admin', () => {
    const platform = teamIdBySlug('platform');
    const dana = danaActor();
    const raj = rajActor();

    grant(adminActor(), platform, raj.id, [
      'MANAGE_TEAM',
      'MANAGE_MEMBERS',
      'MANAGE_INVITES',
      'MANAGE_PERMISSIONS',
      'MANAGE_API_KEYS',
    ]);

    expect(() => teams.updateMemberRole(raj, platform, dana.id, 'MEMBER')).not.toThrow();
  });

  it('lets an owner demote a co-admin', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const dana = danaActor();

    expect(() => teams.updateMemberRole(admin, platform, dana.id, 'MEMBER')).not.toThrow();
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

  it('refuses to let a member remove a co-owner on a MANAGE_MEMBERS grant alone', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const dana = danaActor();
    const raj = rajActor();

    teams.updateMemberRole(admin, platform, dana.id, 'OWNER');
    grant(admin, platform, raj.id, ['MANAGE_MEMBERS']);

    expect(() => teams.removeMember(raj, platform, dana.id)).toThrow(
      'Only an owner can remove another owner',
    );
    expect(
      teams.listTeamMembers(admin, platform).items.some((member) => member.userId === dana.id),
    ).toBe(true);
  });

  it('lets an owner remove a co-owner', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const dana = danaActor();

    teams.updateMemberRole(admin, platform, dana.id, 'OWNER');

    expect(() => teams.removeMember(admin, platform, dana.id)).not.toThrow();
  });

  it('refuses to let a member remove a co-admin on a MANAGE_MEMBERS grant alone', () => {
    const platform = teamIdBySlug('platform');
    const dana = danaActor();
    const raj = rajActor();

    grant(adminActor(), platform, raj.id, ['MANAGE_MEMBERS']);

    expect(() => teams.removeMember(raj, platform, dana.id)).toThrow(
      'You cannot remove an admin while missing a permission they hold by default',
    );
    expect(
      teams
        .listTeamMembers(adminActor(), platform)
        .items.some((member) => member.userId === dana.id),
    ).toBe(true);
  });

  it('lets an owner remove a co-admin', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const dana = danaActor();

    expect(() => teams.removeMember(admin, platform, dana.id)).not.toThrow();
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
    expect(audit.listAuditLogs(adminActor(), { action: 'team.invite.revoked' }).total).toBe(0);
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

  it('refuses to revoke an invite that does not exist', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');

    expect(() => teams.revokeInvite(admin, platform, 'not-a-real-invite-id')).toThrow(
      'Invite not found',
    );
  });

  it("refuses to revoke another team's invite even by its real id", () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const growth = teamIdBySlug('growth');
    const dana = danaActor();

    // Dana owns growth and can issue an invite there; admin has MANAGE_INVITES on
    // platform only. Presenting growth's own, real invite id scoped to platform must
    // read as not found rather than leaking that the id exists on someone else's team.
    const foreignInvite = teams.createInvite(dana, growth, { email: 'outsider@example.com' });

    expect(() => teams.revokeInvite(admin, platform, foreignInvite.id)).toThrow('Invite not found');
    expect(teams.listInvites(dana, growth, { status: 'PENDING' }).total).toBe(1);
  });

  it('refuses to accept an invite whose token does not exist', () => {
    expect(() => teams.acceptInvite(miraActor(), 'not-a-real-token')).toThrow('Invite not found');
  });

  it('is managed by a plain member holding MANAGE_INVITES', () => {
    const platform = teamIdBySlug('platform');
    const raj = rajActor();

    expect(teams.listInvites(raj, platform).total).toBe(1);
    expect(() => teams.createInvite(raj, platform, { email: 'granted@example.com' })).not.toThrow();
  });

  it('refuses to invite someone as admin for a member who lacks every permission it carries', () => {
    // Raj holds only MANAGE_INVITES on Platform. Without this check, he could invite an
    // outside email as ADMIN and have it accepted straight into the other four permissions,
    // the same gap updateMemberRole closes for an in-place promotion.
    const platform = teamIdBySlug('platform');
    const raj = rajActor();

    expect(() =>
      teams.createInvite(raj, platform, { email: 'outsider@example.com', role: 'ADMIN' }),
    ).toThrow(
      'You cannot invite someone into a role that carries a permission you do not hold yourself',
    );
  });

  it('lets a member who holds every permission invite someone as admin', () => {
    const admin = adminActor();
    const platform = teamIdBySlug('platform');
    const raj = rajActor();

    grant(admin, platform, raj.id, [
      'MANAGE_TEAM',
      'MANAGE_MEMBERS',
      'MANAGE_INVITES',
      'MANAGE_PERMISSIONS',
      'MANAGE_API_KEYS',
    ]);

    const invite = teams.createInvite(raj, platform, {
      email: 'outsider2@example.com',
      role: 'ADMIN',
    });

    expect(invite.role).toBe('ADMIN');
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
    expect(audit.listAuditLogs(adminActor(), { action: 'team.deleted' }).total).toBe(1);
  });
});
