import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../src/middleware/rateLimit.js';

function buildApp(limit: number): Express {
  const app = express();
  app.use(createRateLimiter({ limit, windowMs: 60_000 }));
  app.get('/ping', (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe('createRateLimiter', () => {
  it('allows requests under the limit', async () => {
    const app = buildApp(2);

    const first = await request(app).get('/ping');
    const second = await request(app).get('/ping');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it('rejects requests once the limit is exceeded with a consistent error shape', async () => {
    const app = buildApp(2);

    await request(app).get('/ping');
    await request(app).get('/ping');
    const third = await request(app).get('/ping');

    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
  });
});
