import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../common/errors.js';
import { recordAuditLog } from '../audit/audit.service.js';
import { getEffectivePermissions, setMemberPermissionGrants } from './permission.service.js';
import { memberPermissionsParamsSchema, setMemberPermissionsSchema } from './permission.validation.js';

function requireUser(req: Request): { id: string } {
  if (!req.user) {
    throw new UnauthorizedError();
  }
  return req.user;
}

export async function getMemberPermissions(req: Request, res: Response): Promise<void> {
  const { teamId, userId } = memberPermissionsParamsSchema.parse(req.params);
  const permissions = await getEffectivePermissions(teamId, userId);
  res.status(200).json({ permissions });
}

export async function setMemberPermissions(req: Request, res: Response): Promise<void> {
  const actor = requireUser(req);
  const { teamId, userId } = memberPermissionsParamsSchema.parse(req.params);
  const { permissions: grants } = setMemberPermissionsSchema.parse(req.body);

  const permissions = await setMemberPermissionGrants(teamId, userId, grants);

  await recordAuditLog({
    actorId: actor.id,
    action: 'team.member.permissions_updated',
    targetType: 'team',
    targetId: teamId,
    metadata: { userId, permissions: permissions.grantedPermissions },
  });

  res.status(200).json({ permissions });
}
