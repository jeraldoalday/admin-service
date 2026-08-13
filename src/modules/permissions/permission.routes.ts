import { Router } from 'express';
import { asyncHandler } from '../../common/asyncHandler.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { getMemberPermissions, setMemberPermissions } from './permission.controller.js';
import { requirePermission } from './permission.middleware.js';

export const permissionRouter = Router();

permissionRouter.use('/teams', requireAuth);

permissionRouter.get(
  '/teams/:teamId/members/:userId/permissions',
  asyncHandler(requirePermission('MANAGE_PERMISSIONS')),
  asyncHandler(getMemberPermissions),
);
permissionRouter.put(
  '/teams/:teamId/members/:userId/permissions',
  asyncHandler(requirePermission('MANAGE_PERMISSIONS')),
  asyncHandler(setMemberPermissions),
);
