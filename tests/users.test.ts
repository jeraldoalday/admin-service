import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { registerAdmin, registerUser } from './helpers.js';

const app = createApp();

describe('user management RBAC', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await request(app).get('/users');
    expect(res.status).toBe(401);
  });

  it('rejects non-admin members with 403', async () => {
    const member = await registerUser(app);

    const res = await request(app)
      .get('/users')
      .set('Authorization', `Bearer ${member.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });
});

describe('GET /users', () => {
  it('lists users paginated, excluding password hashes', async () => {
    const admin = await registerAdmin(app);
    await registerUser(app);
    await registerUser(app);

    const res = await request(app)
      .get('/users')
      .query({ pageSize: 2 })
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.total).toBe(3);
    expect(res.body.totalPages).toBe(2);
    expect(res.body.items[0].passwordHash).toBeUndefined();
  });

  it('filters by role and search', async () => {
    const admin = await registerAdmin(app);
    await registerUser(app, { email: 'findme@example.com', displayName: 'Findable' });
    await registerUser(app, { email: 'other@example.com' });

    const res = await request(app)
      .get('/users')
      .query({ role: 'MEMBER', search: 'Findable' })
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].email).toBe('findme@example.com');
  });
});

describe('GET /users/:id', () => {
  it('returns 404 for an unknown id', async () => {
    const admin = await registerAdmin(app);

    const res = await request(app)
      .get('/users/does-not-exist')
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(404);
  });
});

describe('PATCH /users/:id', () => {
  it('updates a user and writes an audit log entry', async () => {
    const admin = await registerAdmin(app);
    const member = await registerUser(app);

    const res = await request(app)
      .patch(`/users/${member.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ role: 'ADMIN', displayName: 'Promoted' });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: 'ADMIN', displayName: 'Promoted' });

    const auditRes = await request(app)
      .get('/audit-logs')
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(auditRes.body.items).toHaveLength(1);
    expect(auditRes.body.items[0]).toMatchObject({
      actorId: admin.id,
      action: 'user.updated',
      targetId: member.id,
    });
  });

  it('rejects an empty payload with 400', async () => {
    const admin = await registerAdmin(app);
    const member = await registerUser(app);

    const res = await request(app)
      .patch(`/users/${member.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('prevents an admin from changing their own role', async () => {
    const admin = await registerAdmin(app);

    const res = await request(app)
      .patch(`/users/${admin.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ role: 'MEMBER' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('prevents an admin from deactivating their own account', async () => {
    const admin = await registerAdmin(app);

    const res = await request(app)
      .patch(`/users/${admin.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ isActive: false });

    expect(res.status).toBe(400);
  });

  it('still allows an admin to update their own display name', async () => {
    const admin = await registerAdmin(app);

    const res = await request(app)
      .patch(`/users/${admin.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ displayName: 'New Name' });

    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe('New Name');
  });
});

describe('DELETE /users/:id', () => {
  it('deletes a user and writes an audit log entry', async () => {
    const admin = await registerAdmin(app);
    const member = await registerUser(app);

    const res = await request(app)
      .delete(`/users/${member.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(204);

    const getRes = await request(app)
      .get(`/users/${member.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(getRes.status).toBe(404);

    const auditRes = await request(app)
      .get('/audit-logs')
      .query({ action: 'user.deleted' })
      .set('Authorization', `Bearer ${admin.accessToken}`);
    expect(auditRes.body.items).toHaveLength(1);
  });

  it('prevents an admin from deleting their own account', async () => {
    const admin = await registerAdmin(app);

    const res = await request(app)
      .delete(`/users/${admin.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(400);
  });
});
