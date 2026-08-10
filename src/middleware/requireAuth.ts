import type { NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from '../common/errors.js';
import { verifyAccessToken } from '../modules/auth/jwt.js';

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing bearer token');
  }

  const token = header.slice('Bearer '.length).trim();
  const payload = verifyAccessToken(token);

  req.user = { id: payload.sub, role: payload.role };
  next();
}
