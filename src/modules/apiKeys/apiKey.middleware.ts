import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../../db/prisma.js';
import { ForbiddenError, UnauthorizedError } from '../../common/errors.js';
import type { TeamPermission } from '../../generated/prisma/enums.js';
import { teamIdParamsSchema } from '../teams/team.validation.js';

export function hashApiKeySecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

// Authenticates a service-to-service caller via the X-API-Key header instead of a
// user bearer token, scoping the key to the :teamId in the route so a key minted
// for one team can't be replayed against another team's service routes.
export async function requireApiKey(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.header('x-api-key');
  if (!header) {
    throw new UnauthorizedError('Missing API key');
  }

  const { teamId } = teamIdParamsSchema.parse(req.params);
  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKeySecret(header.trim()) },
  });

  if (!apiKey || apiKey.teamId !== teamId || apiKey.status !== 'ACTIVE') {
    throw new UnauthorizedError('Invalid or revoked API key');
  }

  if (apiKey.expiresAt && apiKey.expiresAt.getTime() < Date.now()) {
    throw new UnauthorizedError('This API key has expired');
  }

  await prisma.apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } });

  req.apiKey = {
    id: apiKey.id,
    teamId: apiKey.teamId,
    permissions: JSON.parse(apiKey.permissions) as TeamPermission[],
  };
  next();
}

export function requireApiKeyScope(permission: TeamPermission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.apiKey) {
      throw new UnauthorizedError();
    }

    if (!req.apiKey.permissions.includes(permission)) {
      throw new ForbiddenError('This API key does not have the required scope');
    }

    next();
  };
}
