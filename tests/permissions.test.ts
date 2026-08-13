import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db/prisma.js';
import { registerUser } from './helpers.js';

const app = createApp();

async function createTeam(accessToken: string, name = 'Acme Corp') {
  const res = await request(app)
    .post('/teams')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ name });
  return res.body.team as { id: string; name: string; slug: string };
}

async function addMember(
  teamId: string,
  ownerToken: string,
  invitee: { email: string; accessToken: string },
): Promise<void> {
  const inviteRes = await request(app)
    .post(`/teams/${teamId}/invites`)
    .set('Authorization', `Bearer ${ownerToken}`)
    .send({ email: invitee.email });

  const invite = await prisma.teamInvite.findUniqueOrThrow({
    where: { id: inviteRes.body.invite.id },
  });

  await request(app)
    .post(`/invites/${invite.token}/accept`)
    .set('Authorization', `Bearer ${invitee.accessToken}`);
}

describe('GET /teams/:teamId/members/:userId/permissions', () => {
  it('returns role defaults with no grants for a plain member', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app, { email: 'member@example.com' });
    const team = await createTeam(owner.accessToken);
    await addMember(team.id, owner.accessToken, member);

    const res = await request(app)
      .get(`/teams/${team.id}/members/${member.id}/permissions`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.permissions).toMatchObject({
      role: 'MEMBER',
      rolePermissions: [],
      grantedPermissions: [],
      effectivePermissions: [],
    });
  });

  it('rejects a plain member from viewing permissions with 403', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app, { email: 'viewer@example.com' });
    const team = await createTeam(owner.accessToken);
    await addMember(team.id, owner.accessToken, member);

    const res = await request(app)
      .get(`/teams/${team.id}/members/${member.id}/permissions`)
      .set('Authorization', `Bearer ${member.accessToken}`);

    expect(res.status).toBe(403);
  });

  it('returns 404 for a non-member caller', async () => {
    const owner = await registerUser(app);
    const outsider = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const res = await request(app)
      .get(`/teams/${team.id}/members/${owner.id}/permissions`)
      .set('Authorization', `Bearer ${outsider.accessToken}`);

    expect(res.status).toBe(404);
  });
});

describe('PUT /teams/:teamId/members/:userId/permissions', () => {
  it('grants a plain member a specific permission beyond their role', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app, { email: 'inviter@example.com' });
    const team = await createTeam(owner.accessToken);
    await addMember(team.id, owner.accessToken, member);

    const grantRes = await request(app)
      .put(`/teams/${team.id}/members/${member.id}/permissions`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ permissions: ['MANAGE_INVITES'] });

    expect(grantRes.status).toBe(200);
    expect(grantRes.body.permissions).toMatchObject({
      role: 'MEMBER',
      grantedPermissions: ['MANAGE_INVITES'],
      effectivePermissions: ['MANAGE_INVITES'],
    });

    // The member still can't rename the team...
    const renameRes = await request(app)
      .patch(`/teams/${team.id}`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ name: 'Nope' });
    expect(renameRes.status).toBe(403);

    // ...but can now create invites, which their base MEMBER role would normally forbid.
    const inviteRes = await request(app)
      .post(`/teams/${team.id}/invites`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ email: 'new-hire@example.com' });
    expect(inviteRes.status).toBe(201);
  });

  it('replaces the full grant set on each call', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app, { email: 'replace-me@example.com' });
    const team = await createTeam(owner.accessToken);
    await addMember(team.id, owner.accessToken, member);

    await request(app)
      .put(`/teams/${team.id}/members/${member.id}/permissions`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ permissions: ['MANAGE_INVITES', 'MANAGE_MEMBERS'] });

    const secondRes = await request(app)
      .put(`/teams/${team.id}/members/${member.id}/permissions`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ permissions: ['MANAGE_TEAM'] });

    expect(secondRes.body.permissions.grantedPermissions).toEqual(['MANAGE_TEAM']);

    const inviteRes = await request(app)
      .post(`/teams/${team.id}/invites`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ email: 'blocked@example.com' });
    expect(inviteRes.status).toBe(403);
  });

  it('rejects a plain member from granting permissions with 403', async () => {
    const owner = await registerUser(app);
    const memberA = await registerUser(app, { email: 'granter@example.com' });
    const memberB = await registerUser(app, { email: 'grantee@example.com' });
    const team = await createTeam(owner.accessToken);
    await addMember(team.id, owner.accessToken, memberA);
    await addMember(team.id, owner.accessToken, memberB);

    const res = await request(app)
      .put(`/teams/${team.id}/members/${memberB.id}/permissions`)
      .set('Authorization', `Bearer ${memberA.accessToken}`)
      .send({ permissions: ['MANAGE_MEMBERS'] });

    expect(res.status).toBe(403);
  });

  it('an admin (default MANAGE_PERMISSIONS) can grant permissions', async () => {
    const owner = await registerUser(app);
    const admin = await registerUser(app, { email: 'admin-grantor@example.com' });
    const member = await registerUser(app, { email: 'grant-target@example.com' });
    const team = await createTeam(owner.accessToken);
    await addMember(team.id, owner.accessToken, admin);
    await addMember(team.id, owner.accessToken, member);
    await request(app)
      .patch(`/teams/${team.id}/members/${admin.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ role: 'ADMIN' });

    const res = await request(app)
      .put(`/teams/${team.id}/members/${member.id}/permissions`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ permissions: ['MANAGE_INVITES'] });

    expect(res.status).toBe(200);
  });

  it('rejects an unknown permission value with 400', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app, { email: 'bad-permission@example.com' });
    const team = await createTeam(owner.accessToken);
    await addMember(team.id, owner.accessToken, member);

    const res = await request(app)
      .put(`/teams/${team.id}/members/${member.id}/permissions`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ permissions: ['NOT_A_REAL_PERMISSION'] });

    expect(res.status).toBe(400);
  });

  it('clears all grants when given an empty array', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app, { email: 'clear-me@example.com' });
    const team = await createTeam(owner.accessToken);
    await addMember(team.id, owner.accessToken, member);

    await request(app)
      .put(`/teams/${team.id}/members/${member.id}/permissions`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ permissions: ['MANAGE_INVITES'] });

    const res = await request(app)
      .put(`/teams/${team.id}/members/${member.id}/permissions`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ permissions: [] });

    expect(res.status).toBe(200);
    expect(res.body.permissions.grantedPermissions).toEqual([]);
  });
});

describe('permission grant cleanup', () => {
  it('clears grants when a member is removed, so rejoining does not restore them', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app, { email: 'rejoiner@example.com' });
    const team = await createTeam(owner.accessToken);
    await addMember(team.id, owner.accessToken, member);

    await request(app)
      .put(`/teams/${team.id}/members/${member.id}/permissions`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ permissions: ['MANAGE_INVITES'] });

    await request(app)
      .delete(`/teams/${team.id}/members/${member.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    await addMember(team.id, owner.accessToken, member);

    const res = await request(app)
      .get(`/teams/${team.id}/members/${member.id}/permissions`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.body.permissions.grantedPermissions).toEqual([]);
  });

  it('clears grants when a member leaves, so rejoining does not restore them', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app, { email: 'leaver-rejoiner@example.com' });
    const team = await createTeam(owner.accessToken);
    await addMember(team.id, owner.accessToken, member);

    await request(app)
      .put(`/teams/${team.id}/members/${member.id}/permissions`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ permissions: ['MANAGE_TEAM'] });

    await request(app)
      .post(`/teams/${team.id}/leave`)
      .set('Authorization', `Bearer ${member.accessToken}`);

    await addMember(team.id, owner.accessToken, member);

    const res = await request(app)
      .get(`/teams/${team.id}/members/${member.id}/permissions`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.body.permissions.grantedPermissions).toEqual([]);
  });
});
