import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { registerAdmin, registerUser } from './helpers.js';

const app = createApp();

describe('GET /audit-logs', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/audit-logs');
    expect(res.status).toBe(401);
  });

  it('rejects non-admin members with 403', async () => {
    const member = await registerUser(app);

    const res = await request(app)
      .get('/audit-logs')
      .set('Authorization', `Bearer ${member.accessToken}`);

    expect(res.status).toBe(403);
  });

  it('records and lists entries with parsed metadata', async () => {
    const admin = await registerAdmin(app);
    const member = await registerUser(app);

    await request(app)
      .patch(`/users/${member.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ displayName: 'Changed' });

    const res = await request(app)
      .get('/audit-logs')
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      actorId: admin.id,
      action: 'user.updated',
      targetType: 'user',
      targetId: member.id,
      metadata: { displayName: 'Changed' },
    });
  });

  it('filters by action', async () => {
    const admin = await registerAdmin(app);
    const memberA = await registerUser(app);
    const memberB = await registerUser(app);

    await request(app)
      .patch(`/users/${memberA.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ displayName: 'Updated' });
    await request(app)
      .delete(`/users/${memberB.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);

    const res = await request(app)
      .get('/audit-logs')
      .query({ action: 'user.deleted' })
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].targetId).toBe(memberB.id);
  });
});
