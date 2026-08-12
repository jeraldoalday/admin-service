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

async function getInviteToken(inviteId: string): Promise<string> {
  const invite = await prisma.teamInvite.findUniqueOrThrow({ where: { id: inviteId } });
  return invite.token;
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

  const token = await getInviteToken(inviteRes.body.invite.id);

  await request(app)
    .post(`/invites/${token}/accept`)
    .set('Authorization', `Bearer ${invitee.accessToken}`);
}

describe('POST /teams', () => {
  it('creates a team and makes the creator its owner', async () => {
    const owner = await registerUser(app);

    const res = await request(app)
      .post('/teams')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Acme Corp' });

    expect(res.status).toBe(201);
    expect(res.body.team).toMatchObject({ name: 'Acme Corp', slug: 'acme-corp' });

    const getRes = await request(app)
      .get(`/teams/${res.body.team.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.role).toBe('OWNER');
  });

  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).post('/teams').send({ name: 'Acme Corp' });
    expect(res.status).toBe(401);
  });
});

describe('GET /teams', () => {
  it('lists only teams the user is a member of', async () => {
    const owner = await registerUser(app);
    const outsider = await registerUser(app);
    await createTeam(owner.accessToken, 'Team One');
    await createTeam(owner.accessToken, 'Team Two');

    const res = await request(app)
      .get('/teams')
      .set('Authorization', `Bearer ${outsider.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);

    const ownerRes = await request(app)
      .get('/teams')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(ownerRes.body.items).toHaveLength(2);
  });
});

describe('GET /teams/:teamId', () => {
  it('returns 404 for a non-member', async () => {
    const owner = await registerUser(app);
    const outsider = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const res = await request(app)
      .get(`/teams/${team.id}`)
      .set('Authorization', `Bearer ${outsider.accessToken}`);

    expect(res.status).toBe(404);
  });
});

describe('PATCH /teams/:teamId', () => {
  it('allows an owner to rename the team', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const res = await request(app)
      .patch(`/teams/${team.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Renamed Inc' });

    expect(res.status).toBe(200);
    expect(res.body.team.name).toBe('Renamed Inc');
  });

  it('rejects a plain member with 403', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app, { email: 'plain-member@example.com' });
    const team = await createTeam(owner.accessToken);
    await addMember(team.id, owner.accessToken, member);

    const res = await request(app)
      .patch(`/teams/${team.id}`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ name: 'Nope' });

    expect(res.status).toBe(403);
  });
});

describe('DELETE /teams/:teamId', () => {
  it('allows an owner to delete the team', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const res = await request(app)
      .delete(`/teams/${team.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(204);

    const getRes = await request(app)
      .get(`/teams/${team.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(getRes.status).toBe(404);
  });
});

describe('team invites', () => {
  it('invites, accepts, and lists a new member', async () => {
    const owner = await registerUser(app);
    const invitee = await registerUser(app, { email: 'invitee@example.com' });
    const team = await createTeam(owner.accessToken);

    const inviteRes = await request(app)
      .post(`/teams/${team.id}/invites`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: 'invitee@example.com', role: 'ADMIN' });
    expect(inviteRes.status).toBe(201);
    expect(inviteRes.body.invite).toMatchObject({ email: 'invitee@example.com', role: 'ADMIN' });

    const token = await getInviteToken(inviteRes.body.invite.id);

    const acceptRes = await request(app)
      .post(`/invites/${token}/accept`)
      .set('Authorization', `Bearer ${invitee.accessToken}`);
    expect(acceptRes.status).toBe(200);
    expect(acceptRes.body.role).toBe('ADMIN');

    const membersRes = await request(app)
      .get(`/teams/${team.id}/members`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(membersRes.body.items).toHaveLength(2);
  });

  it('rejects acceptance from a different email address', async () => {
    const owner = await registerUser(app);
    const wrongUser = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const inviteRes = await request(app)
      .post(`/teams/${team.id}/invites`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: 'someone-else@example.com' });

    const token = await getInviteToken(inviteRes.body.invite.id);

    const res = await request(app)
      .post(`/invites/${token}/accept`)
      .set('Authorization', `Bearer ${wrongUser.accessToken}`);
    expect(res.status).toBe(403);
  });

  it('rejects inviting someone already a member with 409', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const res = await request(app)
      .post(`/teams/${team.id}/invites`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: owner.email });

    expect(res.status).toBe(409);
  });

  it('revokes a pending invite', async () => {
    const owner = await registerUser(app);
    const invitee = await registerUser(app, { email: 'revoke-me@example.com' });
    const team = await createTeam(owner.accessToken);

    const inviteRes = await request(app)
      .post(`/teams/${team.id}/invites`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: 'revoke-me@example.com' });

    const revokeRes = await request(app)
      .delete(`/teams/${team.id}/invites/${inviteRes.body.invite.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(revokeRes.status).toBe(204);

    const token = await getInviteToken(inviteRes.body.invite.id);
    const acceptRes = await request(app)
      .post(`/invites/${token}/accept`)
      .set('Authorization', `Bearer ${invitee.accessToken}`);
    expect(acceptRes.status).toBe(400);
  });
});

describe('team membership management', () => {
  it('changes a member role', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app, { email: 'promote-me@example.com' });
    const team = await createTeam(owner.accessToken);
    await addMember(team.id, owner.accessToken, member);

    const res = await request(app)
      .patch(`/teams/${team.id}/members/${member.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ role: 'ADMIN' });

    expect(res.status).toBe(200);
    expect(res.body.member.role).toBe('ADMIN');
  });

  it('prevents demoting the last owner', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const res = await request(app)
      .patch(`/teams/${team.id}/members/${owner.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ role: 'MEMBER' });

    expect(res.status).toBe(400);
  });

  it('removes a member', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app, { email: 'remove-me@example.com' });
    const team = await createTeam(owner.accessToken);
    await addMember(team.id, owner.accessToken, member);

    const res = await request(app)
      .delete(`/teams/${team.id}/members/${member.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(res.status).toBe(204);

    const membersRes = await request(app)
      .get(`/teams/${team.id}/members`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(membersRes.body.items).toHaveLength(1);
  });

  it('prevents the last owner from leaving', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const res = await request(app)
      .post(`/teams/${team.id}/leave`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(400);
  });

  it('allows a non-owner member to leave', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app, { email: 'leaver@example.com' });
    const team = await createTeam(owner.accessToken);
    await addMember(team.id, owner.accessToken, member);

    const res = await request(app)
      .post(`/teams/${team.id}/leave`)
      .set('Authorization', `Bearer ${member.accessToken}`);
    expect(res.status).toBe(204);

    const membersRes = await request(app)
      .get(`/teams/${team.id}/members`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(membersRes.body.items).toHaveLength(1);
  });
});
