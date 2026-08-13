import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../../db/prisma.js';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../common/errors.js';
import { teamIdParamsSchema } from '../teams/team.validation.js';
import type { TeamPermission } from '../../generated/prisma/enums.js';
import { ROLE_DEFAULT_PERMISSIONS } from './permission.constants.js';

export function requirePermission(permission: TeamPermission) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      throw new UnauthorizedError();
    }

    const { teamId } = teamIdParamsSchema.parse(req.params);
    const membership = await prisma.teamMembership.findUnique({
      where: { teamId_userId: { teamId, userId: req.user.id } },
    });

    if (!membership) {
      throw new NotFoundError('Team not found');
    }

    const hasRolePermission = ROLE_DEFAULT_PERMISSIONS[membership.role].includes(permission);
    const hasGrantedPermission = hasRolePermission
      ? true
      : (await prisma.teamPermissionGrant.findUnique({
          where: { teamId_userId_permission: { teamId, userId: req.user.id, permission } },
        })) !== null;

    if (!hasGrantedPermission) {
      throw new ForbiddenError('You do not have permission to perform this action');
    }

    req.teamMembership = membership;
    next();
  };
}
