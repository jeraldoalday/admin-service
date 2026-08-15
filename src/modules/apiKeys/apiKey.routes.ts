import { Router } from 'express';
import { asyncHandler } from '../../common/asyncHandler.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requirePermission } from '../permissions/permission.middleware.js';
import { listTeamMembers } from '../teams/team.service.js';
import { listMembersQuerySchema, teamIdParamsSchema } from '../teams/team.validation.js';
import { create, get, list, revoke, rotate } from './apiKey.controller.js';
import { requireApiKey, requireApiKeyScope } from './apiKey.middleware.js';

export const apiKeyRouter = Router();

apiKeyRouter.use('/teams/:teamId/api-keys', requireAuth);

apiKeyRouter.post(
  '/teams/:teamId/api-keys',
  asyncHandler(requirePermission('MANAGE_API_KEYS')),
  asyncHandler(create),
);
apiKeyRouter.get(
  '/teams/:teamId/api-keys',
  asyncHandler(requirePermission('MANAGE_API_KEYS')),
  asyncHandler(list),
);
apiKeyRouter.get(
  '/teams/:teamId/api-keys/:keyId',
  asyncHandler(requirePermission('MANAGE_API_KEYS')),
  asyncHandler(get),
);
apiKeyRouter.post(
  '/teams/:teamId/api-keys/:keyId/revoke',
  asyncHandler(requirePermission('MANAGE_API_KEYS')),
  asyncHandler(revoke),
);
apiKeyRouter.post(
  '/teams/:teamId/api-keys/:keyId/rotate',
  asyncHandler(requirePermission('MANAGE_API_KEYS')),
  asyncHandler(rotate),
);

// Machine-facing routes: authenticated with an API key (X-API-Key header) instead of a
// user bearer token, so another service can read team data without a human session.
export const serviceRouter = Router();

serviceRouter.get(
  '/service/teams/:teamId/members',
  asyncHandler(requireApiKey),
  requireApiKeyScope('MANAGE_MEMBERS'),
  asyncHandler(async (req, res) => {
    const { teamId } = teamIdParamsSchema.parse(req.params);
    const query = listMembersQuerySchema.parse(req.query);
    const result = await listTeamMembers(teamId, query);
    res.status(200).json(result);
  }),
);
