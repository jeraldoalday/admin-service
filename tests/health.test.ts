import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const app = createApp();

describe('GET /health', () => {
  it('returns ok status', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });
});

describe('GET /health/ready', () => {
  it('reports the database as up', async () => {
    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready', database: 'up' });
  });
});

describe('unmatched routes', () => {
  it('returns a 404 with a consistent error shape', async () => {
    const res = await request(app).get('/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
