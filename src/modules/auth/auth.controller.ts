import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../common/errors.js';
import {
  getUserFromAccessTokenSubject,
  loginUser,
  refreshAccessToken,
  registerUser,
} from './auth.service.js';
import { loginSchema, refreshSchema, registerSchema } from './auth.validation.js';

export async function register(req: Request, res: Response): Promise<void> {
  const input = registerSchema.parse(req.body);
  const result = await registerUser(input);
  res.status(201).json(result);
}

export async function login(req: Request, res: Response): Promise<void> {
  const input = loginSchema.parse(req.body);
  const result = await loginUser(input);
  res.status(200).json(result);
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const input = refreshSchema.parse(req.body);
  const tokens = await refreshAccessToken(input.refreshToken);
  res.status(200).json({ tokens });
}

export async function me(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError();
  }
  const user = await getUserFromAccessTokenSubject(req.user.id);
  if (!user) {
    throw new UnauthorizedError('User no longer exists');
  }
  res.status(200).json({ user });
}
