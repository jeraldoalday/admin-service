import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const app = createApp();

const credentials = {
  email: 'jane@example.com',
  password: 'correcthorsebattery',
  displayName: 'Jane Doe',
};

async function registerJane() {
  return request(app).post('/auth/register').send(credentials);
}

describe('POST /auth/register', () => {
  it('creates a user and returns tokens', async () => {
    const res = await registerJane();

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      email: credentials.email,
      displayName: credentials.displayName,
      role: 'MEMBER',
    });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(typeof res.body.tokens.accessToken).toBe('string');
    expect(typeof res.body.tokens.refreshToken).toBe('string');
  });

  it('rejects a duplicate email with 409', async () => {
    await registerJane();
    const res = await registerJane();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects an invalid payload with 400 and field errors', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'not-an-email', password: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fieldErrors.email).toBeDefined();
    expect(res.body.error.details.fieldErrors.password).toBeDefined();
  });
});

describe('POST /auth/login', () => {
  beforeEach(async () => {
    await registerJane();
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: credentials.email, password: credentials.password });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(credentials.email);
  });

  it('rejects an unknown email with 401', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever123' });

    expect(res.status).toBe(401);
  });

  it('rejects an incorrect password with 401', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: credentials.email, password: 'wrong-password' });

    expect(res.status).toBe(401);
  });
});

describe('GET /auth/me', () => {
  it('rejects requests without a bearer token', async () => {
    const res = await request(app).get('/auth/me');

    expect(res.status).toBe(401);
  });

  it('rejects malformed bearer tokens', async () => {
    const res = await request(app).get('/auth/me').set('Authorization', 'Bearer not-a-real-token');

    expect(res.status).toBe(401);
  });

  it('returns the authenticated user for a valid token', async () => {
    const registerRes = await registerJane();
    const { accessToken } = registerRes.body.tokens;

    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(credentials.email);
  });
});

describe('POST /auth/refresh', () => {
  it('issues a new access token for a valid refresh token', async () => {
    const registerRes = await registerJane();
    const { refreshToken } = registerRes.body.tokens;

    const res = await request(app).post('/auth/refresh').send({ refreshToken });

    expect(res.status).toBe(200);
    expect(typeof res.body.tokens.accessToken).toBe('string');
    expect(typeof res.body.tokens.refreshToken).toBe('string');
  });

  it('rejects an invalid refresh token with 401', async () => {
    const res = await request(app).post('/auth/refresh').send({ refreshToken: 'garbage' });

    expect(res.status).toBe(401);
  });
});
