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
import { requireTeamMembership } from './team.middleware.js';

export const teamRouter = Router();

teamRouter.use('/teams', requireAuth);

teamRouter.post('/teams', asyncHandler(create));
teamRouter.get('/teams', asyncHandler(list));
teamRouter.get('/teams/:teamId', asyncHandler(requireTeamMembership()), asyncHandler(get));
teamRouter.patch(
  '/teams/:teamId',
  asyncHandler(requireTeamMembership('OWNER', 'ADMIN')),
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
  asyncHandler(requireTeamMembership('OWNER', 'ADMIN')),
  asyncHandler(changeMemberRole),
);
teamRouter.delete(
  '/teams/:teamId/members/:userId',
  asyncHandler(requireTeamMembership('OWNER', 'ADMIN')),
  asyncHandler(deleteMember),
);
teamRouter.post('/teams/:teamId/leave', asyncHandler(requireTeamMembership()), asyncHandler(leave));

teamRouter.post(
  '/teams/:teamId/invites',
  asyncHandler(requireTeamMembership('OWNER', 'ADMIN')),
  asyncHandler(createTeamInvite),
);
teamRouter.get(
  '/teams/:teamId/invites',
  asyncHandler(requireTeamMembership('OWNER', 'ADMIN')),
  asyncHandler(listTeamInvites),
);
teamRouter.delete(
  '/teams/:teamId/invites/:inviteId',
  asyncHandler(requireTeamMembership('OWNER', 'ADMIN')),
  asyncHandler(deleteInvite),
);

export const inviteRouter = Router();

inviteRouter.post('/invites/:token/accept', requireAuth, asyncHandler(acceptTeamInvite));
