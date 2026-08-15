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

describe('POST /teams/:teamId/api-keys', () => {
  it('creates a key and returns the plaintext secret exactly once', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const res = await request(app)
      .post(`/teams/${team.id}/api-keys`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'CI runner', permissions: ['MANAGE_MEMBERS'] });

    expect(res.status).toBe(201);
    expect(typeof res.body.secret).toBe('string');
    expect(res.body.secret.startsWith('sk_')).toBe(true);
    expect(res.body.apiKey).toMatchObject({
      name: 'CI runner',
      permissions: ['MANAGE_MEMBERS'],
      status: 'ACTIVE',
    });
    expect(res.body.apiKey.keyPrefix.startsWith('sk_')).toBe(true);
    expect(res.body.apiKey).not.toHaveProperty('keyHash');
    expect(res.body.apiKey).not.toHaveProperty('secret');
  });

  it('rejects a plain member with 403', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app, { email: 'plain-member@example.com' });
    const team = await createTeam(owner.accessToken);
    await addMember(team.id, owner.accessToken, member);

    const res = await request(app)
      .post(`/teams/${team.id}/api-keys`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ name: 'Nope' });

    expect(res.status).toBe(403);
  });

  it('rejects an expiresAt in the past with 400', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const res = await request(app)
      .post(`/teams/${team.id}/api-keys`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Backdated', expiresAt: '2000-01-01T00:00:00.000Z' });

    expect(res.status).toBe(400);
  });
});

describe('GET /teams/:teamId/api-keys', () => {
  it('lists keys without leaking the hash', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);
    await request(app)
      .post(`/teams/${team.id}/api-keys`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Key A' });

    const res = await request(app)
      .get(`/teams/${team.id}/api-keys`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).not.toHaveProperty('keyHash');
    expect(res.body.items[0]).not.toHaveProperty('secret');
  });
});

describe('POST /teams/:teamId/api-keys/:keyId/revoke', () => {
  it('revokes a key so it can no longer authenticate', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const createRes = await request(app)
      .post(`/teams/${team.id}/api-keys`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'To revoke', permissions: ['MANAGE_MEMBERS'] });

    const revokeRes = await request(app)
      .post(`/teams/${team.id}/api-keys/${createRes.body.apiKey.id}/revoke`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.apiKey.status).toBe('REVOKED');

    const serviceRes = await request(app)
      .get(`/service/teams/${team.id}/members`)
      .set('X-API-Key', createRes.body.secret);
    expect(serviceRes.status).toBe(401);
  });

  it('rejects revoking an already-revoked key with 400', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const createRes = await request(app)
      .post(`/teams/${team.id}/api-keys`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Double revoke' });

    await request(app)
      .post(`/teams/${team.id}/api-keys/${createRes.body.apiKey.id}/revoke`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const secondRevoke = await request(app)
      .post(`/teams/${team.id}/api-keys/${createRes.body.apiKey.id}/revoke`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(secondRevoke.status).toBe(400);
  });
});

describe('POST /teams/:teamId/api-keys/:keyId/rotate', () => {
  it('invalidates the old secret and issues a working replacement', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const createRes = await request(app)
      .post(`/teams/${team.id}/api-keys`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Rotate me', permissions: ['MANAGE_MEMBERS'] });
    const oldSecret = createRes.body.secret as string;

    const rotateRes = await request(app)
      .post(`/teams/${team.id}/api-keys/${createRes.body.apiKey.id}/rotate`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(rotateRes.status).toBe(200);
    expect(rotateRes.body.apiKey.name).toBe('Rotate me');
    expect(rotateRes.body.apiKey.permissions).toEqual(['MANAGE_MEMBERS']);
    expect(rotateRes.body.secret).not.toBe(oldSecret);

    const oldSecretRes = await request(app)
      .get(`/service/teams/${team.id}/members`)
      .set('X-API-Key', oldSecret);
    expect(oldSecretRes.status).toBe(401);

    const newSecretRes = await request(app)
      .get(`/service/teams/${team.id}/members`)
      .set('X-API-Key', rotateRes.body.secret);
    expect(newSecretRes.status).toBe(200);
  });
});

describe('GET /service/teams/:teamId/members (API key auth)', () => {
  it('rejects a request with no API key', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const res = await request(app).get(`/service/teams/${team.id}/members`);
    expect(res.status).toBe(401);
  });

  it('rejects an unknown API key', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const res = await request(app)
      .get(`/service/teams/${team.id}/members`)
      .set('X-API-Key', 'sk_not_a_real_key');
    expect(res.status).toBe(401);
  });

  it('rejects a valid key scoped to a different team', async () => {
    const owner = await registerUser(app);
    const teamA = await createTeam(owner.accessToken, 'Team A');
    const teamB = await createTeam(owner.accessToken, 'Team B');

    const createRes = await request(app)
      .post(`/teams/${teamA.id}/api-keys`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Team A key', permissions: ['MANAGE_MEMBERS'] });

    const res = await request(app)
      .get(`/service/teams/${teamB.id}/members`)
      .set('X-API-Key', createRes.body.secret);
    expect(res.status).toBe(401);
  });

  it('rejects a key missing the required scope with 403', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const createRes = await request(app)
      .post(`/teams/${team.id}/api-keys`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'No scope', permissions: ['MANAGE_INVITES'] });

    const res = await request(app)
      .get(`/service/teams/${team.id}/members`)
      .set('X-API-Key', createRes.body.secret);
    expect(res.status).toBe(403);
  });

  it('lists members for a key with the right scope and records lastUsedAt', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const createRes = await request(app)
      .post(`/teams/${team.id}/api-keys`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Read members', permissions: ['MANAGE_MEMBERS'] });

    const res = await request(app)
      .get(`/service/teams/${team.id}/members`)
      .set('X-API-Key', createRes.body.secret);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);

    const stored = await prisma.apiKey.findUniqueOrThrow({
      where: { id: createRes.body.apiKey.id },
    });
    expect(stored.lastUsedAt).not.toBeNull();
  });

  it('rejects an expired key', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const createRes = await request(app)
      .post(`/teams/${team.id}/api-keys`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Expires soon', permissions: ['MANAGE_MEMBERS'] });

    await prisma.apiKey.update({
      where: { id: createRes.body.apiKey.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app)
      .get(`/service/teams/${team.id}/members`)
      .set('X-API-Key', createRes.body.secret);
    expect(res.status).toBe(401);
  });
});

describe('invite conflict check ignores expired pending invites (regression)', () => {
  it('allows re-inviting an email whose earlier invite quietly expired', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const firstInvite = await request(app)
      .post(`/teams/${team.id}/invites`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: 'stale@example.com' });
    expect(firstInvite.status).toBe(201);

    // Simulate time passing without anyone attempting to accept the invite,
    // so its status is still PENDING even though expiresAt is in the past.
    await prisma.teamInvite.update({
      where: { id: firstInvite.body.invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const secondInvite = await request(app)
      .post(`/teams/${team.id}/invites`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ email: 'stale@example.com' });

    expect(secondInvite.status).toBe(201);
  });
});

describe('GET /teams/:teamId/api-keys/:keyId', () => {
  it('returns a single key', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);
    const createRes = await request(app)
      .post(`/teams/${team.id}/api-keys`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Solo lookup' });

    const res = await request(app)
      .get(`/teams/${team.id}/api-keys/${createRes.body.apiKey.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.apiKey.name).toBe('Solo lookup');
  });

  it('returns 404 for a key that belongs to a different team', async () => {
    const owner = await registerUser(app);
    const teamA = await createTeam(owner.accessToken, 'Team A');
    const teamB = await createTeam(owner.accessToken, 'Team B');
    const createRes = await request(app)
      .post(`/teams/${teamA.id}/api-keys`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Team A only' });

    const res = await request(app)
      .get(`/teams/${teamB.id}/api-keys/${createRes.body.apiKey.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown key id', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const res = await request(app)
      .get(`/teams/${team.id}/api-keys/not-a-real-id`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(404);
  });
});

describe('API key management authorization', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const res = await request(app).post(`/teams/${team.id}/api-keys`).send({ name: 'Nope' });
    expect(res.status).toBe(401);
  });

  it('rejects a plain member from listing keys with 403', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app, { email: 'no-access@example.com' });
    const team = await createTeam(owner.accessToken);
    await addMember(team.id, owner.accessToken, member);

    const res = await request(app)
      .get(`/teams/${team.id}/api-keys`)
      .set('Authorization', `Bearer ${member.accessToken}`);

    expect(res.status).toBe(403);
  });

  it('rejects a plain member from rotating a key with 403', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app, { email: 'no-rotate@example.com' });
    const team = await createTeam(owner.accessToken);
    await addMember(team.id, owner.accessToken, member);

    const createRes = await request(app)
      .post(`/teams/${team.id}/api-keys`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Owner only' });

    const res = await request(app)
      .post(`/teams/${team.id}/api-keys/${createRes.body.apiKey.id}/rotate`)
      .set('Authorization', `Bearer ${member.accessToken}`);

    expect(res.status).toBe(403);
  });

  it('a member granted MANAGE_API_KEYS can create a key without being promoted', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app, { email: 'granted-keys@example.com' });
    const team = await createTeam(owner.accessToken);
    await addMember(team.id, owner.accessToken, member);

    await request(app)
      .put(`/teams/${team.id}/members/${member.id}/permissions`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ permissions: ['MANAGE_API_KEYS'] });

    const res = await request(app)
      .post(`/teams/${team.id}/api-keys`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send({ name: 'Granted access' });

    expect(res.status).toBe(201);
  });
});

describe('POST /teams/:teamId/api-keys/:keyId/rotate edge cases', () => {
  it('rejects rotating an already-revoked key with 400', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);
    const createRes = await request(app)
      .post(`/teams/${team.id}/api-keys`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Revoke then rotate' });

    await request(app)
      .post(`/teams/${team.id}/api-keys/${createRes.body.apiKey.id}/revoke`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const res = await request(app)
      .post(`/teams/${team.id}/api-keys/${createRes.body.apiKey.id}/rotate`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(400);
  });

  it('returns 404 when rotating a key that does not exist', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const res = await request(app)
      .post(`/teams/${team.id}/api-keys/not-a-real-id/rotate`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(404);
  });
});

describe('GET /teams/:teamId/api-keys status filtering', () => {
  it('filters by status', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const active = await request(app)
      .post(`/teams/${team.id}/api-keys`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Stays active' });
    const revoked = await request(app)
      .post(`/teams/${team.id}/api-keys`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Gets revoked' });
    await request(app)
      .post(`/teams/${team.id}/api-keys/${revoked.body.apiKey.id}/revoke`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    const activeRes = await request(app)
      .get(`/teams/${team.id}/api-keys?status=ACTIVE`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(activeRes.body.items).toHaveLength(1);
    expect(activeRes.body.items[0].id).toBe(active.body.apiKey.id);

    const revokedRes = await request(app)
      .get(`/teams/${team.id}/api-keys?status=REVOKED`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(revokedRes.body.items).toHaveLength(1);
    expect(revokedRes.body.items[0].id).toBe(revoked.body.apiKey.id);
  });
});

describe('POST /teams/:teamId/api-keys permission validation', () => {
  it('rejects an unknown permission value with 400', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const res = await request(app)
      .post(`/teams/${team.id}/api-keys`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Bad scope', permissions: ['NOT_A_REAL_PERMISSION'] });

    expect(res.status).toBe(400);
  });

  it('defaults to no permissions, which the service guard then rejects with 403', async () => {
    const owner = await registerUser(app);
    const team = await createTeam(owner.accessToken);

    const createRes = await request(app)
      .post(`/teams/${team.id}/api-keys`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'No scopes' });

    expect(createRes.body.apiKey.permissions).toEqual([]);

    const res = await request(app)
      .get(`/service/teams/${team.id}/members`)
      .set('X-API-Key', createRes.body.secret);
    expect(res.status).toBe(403);
  });
});
