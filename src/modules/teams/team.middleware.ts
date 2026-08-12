import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../../db/prisma.js';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../common/errors.js';
import type { TeamRole } from '../../generated/prisma/enums.js';
import { teamIdParamsSchema } from './team.validation.js';

export function requireTeamMembership(...allowedRoles: TeamRole[]) {
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

    if (allowedRoles.length > 0 && !allowedRoles.includes(membership.role)) {
      throw new ForbiddenError('You do not have permission to perform this action');
    }

    req.teamMembership = membership;
    next();
  };
}
