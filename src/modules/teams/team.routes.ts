import { Router } from 'express';
import { asyncHandler } from '../../common/asyncHandler.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import {
  acceptTeamInvite,
  changeMemberRole,
  create,
  createTeamInvite,
  deleteInvite,
  deleteMember,
  get,
  leave,
  list,
  listMembers,
  listTeamInvites,
  remove,
  update,
} from './team.controller.js';
import { requirePermission } from '../permissions/permission.middleware.js';
import { requireTeamMembership } from './team.middleware.js';

export const teamRouter = Router();

teamRouter.use('/teams', requireAuth);

teamRouter.post('/teams', asyncHandler(create));
teamRouter.get('/teams', asyncHandler(list));
teamRouter.get('/teams/:teamId', asyncHandler(requireTeamMembership()), asyncHandler(get));
teamRouter.patch(
  '/teams/:teamId',
  asyncHandler(requirePermission('MANAGE_TEAM')),
  asyncHandler(update),
);
teamRouter.delete(
  '/teams/:teamId',
  asyncHandler(requireTeamMembership('OWNER')),
  asyncHandler(remove),
);

teamRouter.get(
  '/teams/:teamId/members',
  asyncHandler(requireTeamMembership()),
  asyncHandler(listMembers),
);
teamRouter.patch(
  '/teams/:teamId/members/:userId',
  asyncHandler(requirePermission('MANAGE_MEMBERS')),
  asyncHandler(changeMemberRole),
);
teamRouter.delete(
  '/teams/:teamId/members/:userId',
  asyncHandler(requirePermission('MANAGE_MEMBERS')),
  asyncHandler(deleteMember),
);
teamRouter.post('/teams/:teamId/leave', asyncHandler(requireTeamMembership()), asyncHandler(leave));

teamRouter.post(
  '/teams/:teamId/invites',
  asyncHandler(requirePermission('MANAGE_INVITES')),
  asyncHandler(createTeamInvite),
);
teamRouter.get(
  '/teams/:teamId/invites',
  asyncHandler(requirePermission('MANAGE_INVITES')),
  asyncHandler(listTeamInvites),
);
teamRouter.delete(
  '/teams/:teamId/invites/:inviteId',
  asyncHandler(requirePermission('MANAGE_INVITES')),
  asyncHandler(deleteInvite),
);

export const inviteRouter = Router();

inviteRouter.post('/invites/:token/accept', requireAuth, asyncHandler(acceptTeamInvite));
