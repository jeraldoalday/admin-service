import type { Express } from 'express';
import request from 'supertest';
import { prisma } from '../src/db/prisma.js';

export interface RegisteredUser {
  id: string;
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
}

let counter = 0;

export async function registerUser(
  app: Express,
  overrides: Partial<{ email: string; password: string; displayName: string }> = {},
): Promise<RegisteredUser> {
  counter += 1;
  const email = overrides.email ?? `user-${counter}@example.com`;
  const password = overrides.password ?? 'correcthorsebattery';
  const displayName = overrides.displayName ?? 'Test User';

  const res = await request(app).post('/auth/register').send({ email, password, displayName });

  return {
    id: res.body.user.id as string,
    email,
    password,
    accessToken: res.body.tokens.accessToken as string,
    refreshToken: res.body.tokens.refreshToken as string,
  };
}

// Registering always creates a MEMBER; promote via Prisma directly, then
// re-login so the returned access token carries the updated ADMIN role
// (the role is embedded in the JWT at issuance time).
export async function registerAdmin(
  app: Express,
  overrides: Partial<{ email: string; password: string; displayName: string }> = {},
): Promise<RegisteredUser> {
  const user = await registerUser(app, overrides);
  await prisma.user.update({ where: { id: user.id }, data: { role: 'ADMIN' } });

  const loginRes = await request(app)
    .post('/auth/login')
    .send({ email: user.email, password: user.password });

  return {
    ...user,
    accessToken: loginRes.body.tokens.accessToken as string,
    refreshToken: loginRes.body.tokens.refreshToken as string,
  };
}
