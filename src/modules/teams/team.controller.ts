import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../common/errors.js';
import { recordAuditLog } from '../audit/audit.service.js';
import {
  acceptInvite as acceptInviteService,
  createInvite,
  createTeam,
  deleteTeam,
  getTeamById,
  leaveTeam,
  listInvites,
  listTeamMembers,
  listTeamsForUser,
  removeMember,
  revokeInvite,
  updateMemberRole,
  updateTeam,
} from './team.service.js';
import {
  acceptInviteParamsSchema,
  createInviteSchema,
  createTeamSchema,
  listInvitesQuerySchema,
  listMembersQuerySchema,
  listTeamsQuerySchema,
  teamIdParamsSchema,
  teamInviteParamsSchema,
  teamMemberParamsSchema,
  updateMemberRoleSchema,
  updateTeamSchema,
} from './team.validation.js';

function requireUser(req: Request): { id: string } {
  if (!req.user) {
    throw new UnauthorizedError();
  }
  return req.user;
}

export async function create(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = createTeamSchema.parse(req.body);

  const { team } = await createTeam(user.id, input);

  await recordAuditLog({
    actorId: user.id,
    action: 'team.created',
    targetType: 'team',
    targetId: team.id,
  });

  res.status(201).json({ team });
}

export async function list(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = listTeamsQuerySchema.parse(req.query);
  const result = await listTeamsForUser(user.id, query);
  res.status(200).json(result);
}

export async function get(req: Request, res: Response): Promise<void> {
  const { teamId } = teamIdParamsSchema.parse(req.params);
  const team = await getTeamById(teamId);
  res.status(200).json({ team, role: req.teamMembership?.role });
}

export async function update(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { teamId } = teamIdParamsSchema.parse(req.params);
  const input = updateTeamSchema.parse(req.body);

  const team = await updateTeam(teamId, input);

  await recordAuditLog({
    actorId: user.id,
    action: 'team.updated',
    targetType: 'team',
    targetId: teamId,
    metadata: input,
  });

  res.status(200).json({ team });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { teamId } = teamIdParamsSchema.parse(req.params);

  await deleteTeam(teamId);

  await recordAuditLog({
    actorId: user.id,
    action: 'team.deleted',
    targetType: 'team',
    targetId: teamId,
  });

  res.status(204).send();
}

export async function listMembers(req: Request, res: Response): Promise<void> {
  const { teamId } = teamIdParamsSchema.parse(req.params);
  const query = listMembersQuerySchema.parse(req.query);
  const result = await listTeamMembers(teamId, query);
  res.status(200).json(result);
}

export async function changeMemberRole(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { teamId, userId } = teamMemberParamsSchema.parse(req.params);
  const { role } = updateMemberRoleSchema.parse(req.body);

  const member = await updateMemberRole(teamId, userId, role);

  await recordAuditLog({
    actorId: user.id,
    action: 'team.member.role_updated',
    targetType: 'team',
    targetId: teamId,
    metadata: { userId, role },
  });

  res.status(200).json({ member });
}

export async function deleteMember(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { teamId, userId } = teamMemberParamsSchema.parse(req.params);

  await removeMember(teamId, userId);

  await recordAuditLog({
    actorId: user.id,
    action: 'team.member.removed',
    targetType: 'team',
    targetId: teamId,
    metadata: { userId },
  });

  res.status(204).send();
}

export async function leave(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { teamId } = teamIdParamsSchema.parse(req.params);

  await leaveTeam(teamId, user.id);

  await recordAuditLog({
    actorId: user.id,
    action: 'team.member.left',
    targetType: 'team',
    targetId: teamId,
  });

  res.status(204).send();
}

export async function createTeamInvite(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { teamId } = teamIdParamsSchema.parse(req.params);
  const input = createInviteSchema.parse(req.body);

  const invite = await createInvite(teamId, user.id, input);

  await recordAuditLog({
    actorId: user.id,
    action: 'team.invite.created',
    targetType: 'team',
    targetId: teamId,
    metadata: { email: input.email, role: input.role },
  });

  res.status(201).json({ invite });
}

export async function listTeamInvites(req: Request, res: Response): Promise<void> {
  const { teamId } = teamIdParamsSchema.parse(req.params);
  const query = listInvitesQuerySchema.parse(req.query);
  const result = await listInvites(teamId, query);
  res.status(200).json(result);
}

export async function deleteInvite(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { teamId, inviteId } = teamInviteParamsSchema.parse(req.params);

  await revokeInvite(teamId, inviteId);

  await recordAuditLog({
    actorId: user.id,
    action: 'team.invite.revoked',
    targetType: 'team',
    targetId: teamId,
    metadata: { inviteId },
  });

  res.status(204).send();
}

export async function acceptTeamInvite(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { token } = acceptInviteParamsSchema.parse(req.params);

  const { team, role } = await acceptInviteService(token, user.id);

  await recordAuditLog({
    actorId: user.id,
    action: 'team.invite.accepted',
    targetType: 'team',
    targetId: team.id,
  });

  res.status(200).json({ team, role });
}
