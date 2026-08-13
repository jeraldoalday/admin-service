import { randomBytes } from 'node:crypto';
import { prisma } from '../../db/prisma.js';
import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../common/errors.js';
import {
  buildPaginatedResult,
  paginationToSkipTake,
  type PaginatedResult,
} from '../../common/pagination.js';
import type { InviteStatus, TeamRole } from '../../generated/prisma/enums.js';
import type {
  CreateInviteInput,
  CreateTeamInput,
  ListInvitesQuery,
  ListMembersQuery,
  ListTeamsQuery,
  UpdateTeamInput,
} from './team.validation.js';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface TeamView {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamMemberView {
  userId: string;
  email: string;
  displayName: string;
  role: TeamRole;
  createdAt: Date;
}

export interface TeamInviteView {
  id: string;
  teamId: string;
  email: string;
  role: TeamRole;
  status: InviteStatus;
  expiresAt: Date;
  createdAt: Date;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toTeamView(team: {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}): TeamView {
  const { id, name, slug, createdAt, updatedAt } = team;
  return { id, name, slug, createdAt, updatedAt };
}

function toInviteView(invite: {
  id: string;
  teamId: string;
  email: string;
  role: TeamRole;
  status: InviteStatus;
  expiresAt: Date;
  createdAt: Date;
}): TeamInviteView {
  const { id, teamId, email, role, status, expiresAt, createdAt } = invite;
  return { id, teamId, email, role, status, expiresAt, createdAt };
}

export async function createTeam(
  ownerId: string,
  input: CreateTeamInput,
): Promise<{ team: TeamView; membership: { role: TeamRole } }> {
  const baseSlug = slugify(input.name) || 'team';
  const existing = await prisma.team.findUnique({ where: { slug: baseSlug } });
  const slug = existing ? `${baseSlug}-${randomBytes(3).toString('hex')}` : baseSlug;

  const team = await prisma.team.create({
    data: {
      name: input.name,
      slug,
      memberships: {
        create: { userId: ownerId, role: 'OWNER' },
      },
    },
  });

  return { team: toTeamView(team), membership: { role: 'OWNER' } };
}

export async function listTeamsForUser(
  userId: string,
  query: ListTeamsQuery,
): Promise<PaginatedResult<TeamView & { role: TeamRole }>> {
  const where = { memberships: { some: { userId } } };

  const [memberships, total] = await Promise.all([
    prisma.teamMembership.findMany({
      where: { userId },
      include: { team: true },
      orderBy: { createdAt: 'desc' },
      ...paginationToSkipTake(query),
    }),
    prisma.team.count({ where }),
  ]);

  const items = memberships.map((membership) => ({
    ...toTeamView(membership.team),
    role: membership.role,
  }));

  return buildPaginatedResult(items, total, query);
}

export async function getTeamById(teamId: string): Promise<TeamView> {
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) {
    throw new NotFoundError('Team not found');
  }
  return toTeamView(team);
}

export async function updateTeam(teamId: string, input: UpdateTeamInput): Promise<TeamView> {
  const team = await prisma.team.update({ where: { id: teamId }, data: { name: input.name } });
  return toTeamView(team);
}

export async function deleteTeam(teamId: string): Promise<void> {
  await prisma.team.delete({ where: { id: teamId } });
}

export async function listTeamMembers(
  teamId: string,
  query: ListMembersQuery,
): Promise<PaginatedResult<TeamMemberView>> {
  const where = { teamId };

  const [memberships, total] = await Promise.all([
    prisma.teamMembership.findMany({
      where,
      include: { user: true },
      orderBy: { createdAt: 'asc' },
      ...paginationToSkipTake(query),
    }),
    prisma.teamMembership.count({ where }),
  ]);

  const items = memberships.map((membership) => ({
    userId: membership.userId,
    email: membership.user.email,
    displayName: membership.user.displayName,
    role: membership.role,
    createdAt: membership.createdAt,
  }));

  return buildPaginatedResult(items, total, query);
}

async function countOwners(teamId: string): Promise<number> {
  return prisma.teamMembership.count({ where: { teamId, role: 'OWNER' } });
}

export async function updateMemberRole(
  teamId: string,
  targetUserId: string,
  role: TeamRole,
): Promise<TeamMemberView> {
  const membership = await prisma.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId: targetUserId } },
    include: { user: true },
  });
  if (!membership) {
    throw new NotFoundError('Team member not found');
  }

  if (membership.role === 'OWNER' && role !== 'OWNER' && (await countOwners(teamId)) <= 1) {
    throw new BadRequestError('A team must have at least one owner');
  }

  const updated = await prisma.teamMembership.update({
    where: { teamId_userId: { teamId, userId: targetUserId } },
    data: { role },
    include: { user: true },
  });

  return {
    userId: updated.userId,
    email: updated.user.email,
    displayName: updated.user.displayName,
    role: updated.role,
    createdAt: updated.createdAt,
  };
}

export async function removeMember(teamId: string, targetUserId: string): Promise<void> {
  const membership = await prisma.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId: targetUserId } },
  });
  if (!membership) {
    throw new NotFoundError('Team member not found');
  }

  if (membership.role === 'OWNER' && (await countOwners(teamId)) <= 1) {
    throw new BadRequestError('A team must have at least one owner');
  }

  // Also clear any permission grants so a later re-invite starts from a clean slate
  // instead of silently restoring the access this member had before they left.
  await prisma.$transaction([
    prisma.teamPermissionGrant.deleteMany({ where: { teamId, userId: targetUserId } }),
    prisma.teamMembership.delete({ where: { teamId_userId: { teamId, userId: targetUserId } } }),
  ]);
}

export async function leaveTeam(teamId: string, userId: string): Promise<void> {
  const membership = await prisma.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  if (!membership) {
    throw new NotFoundError('Team not found');
  }

  if (membership.role === 'OWNER' && (await countOwners(teamId)) <= 1) {
    throw new BadRequestError(
      'The last owner cannot leave the team; transfer ownership or delete the team first',
    );
  }

  await prisma.$transaction([
    prisma.teamPermissionGrant.deleteMany({ where: { teamId, userId } }),
    prisma.teamMembership.delete({ where: { teamId_userId: { teamId, userId } } }),
  ]);
}

export async function createInvite(
  teamId: string,
  invitedById: string,
  input: CreateInviteInput,
): Promise<TeamInviteView> {
  const existingMember = await prisma.teamMembership.findFirst({
    where: { teamId, user: { email: input.email } },
  });
  if (existingMember) {
    throw new ConflictError('This person is already a member of the team');
  }

  const existingInvite = await prisma.teamInvite.findFirst({
    where: { teamId, email: input.email, status: 'PENDING' },
  });
  if (existingInvite) {
    throw new ConflictError('There is already a pending invite for this email');
  }

  const invite = await prisma.teamInvite.create({
    data: {
      teamId,
      email: input.email,
      role: input.role,
      token: randomBytes(24).toString('hex'),
      invitedById,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });

  return toInviteView(invite);
}

export async function listInvites(
  teamId: string,
  query: ListInvitesQuery,
): Promise<PaginatedResult<TeamInviteView>> {
  const where = {
    teamId,
    ...(query.status ? { status: query.status } : {}),
  };

  const [invites, total] = await Promise.all([
    prisma.teamInvite.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...paginationToSkipTake(query),
    }),
    prisma.teamInvite.count({ where }),
  ]);

  return buildPaginatedResult(invites.map(toInviteView), total, query);
}

export async function revokeInvite(teamId: string, inviteId: string): Promise<void> {
  const invite = await prisma.teamInvite.findUnique({ where: { id: inviteId } });
  if (!invite || invite.teamId !== teamId) {
    throw new NotFoundError('Invite not found');
  }
  if (invite.status !== 'PENDING') {
    throw new BadRequestError('Only pending invites can be revoked');
  }

  await prisma.teamInvite.update({ where: { id: inviteId }, data: { status: 'REVOKED' } });
}

export async function acceptInvite(
  token: string,
  userId: string,
): Promise<{ team: TeamView; role: TeamRole }> {
  const invite = await prisma.teamInvite.findUnique({ where: { token }, include: { team: true } });
  if (!invite) {
    throw new NotFoundError('Invite not found');
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  if (
    invite.status === 'EXPIRED' ||
    (invite.status === 'PENDING' && invite.expiresAt < new Date())
  ) {
    if (invite.status === 'PENDING') {
      await prisma.teamInvite.update({ where: { id: invite.id }, data: { status: 'EXPIRED' } });
    }
    throw new BadRequestError('This invite has expired');
  }

  if (invite.status !== 'PENDING') {
    throw new BadRequestError('This invite is no longer valid');
  }

  if (invite.email !== user.email) {
    throw new ForbiddenError('This invite was issued to a different email address');
  }

  await prisma.$transaction([
    prisma.teamMembership.upsert({
      where: { teamId_userId: { teamId: invite.teamId, userId } },
      create: { teamId: invite.teamId, userId, role: invite.role },
      update: {},
    }),
    prisma.teamInvite.update({ where: { id: invite.id }, data: { status: 'ACCEPTED' } }),
  ]);

  return { team: toTeamView(invite.team), role: invite.role };
}
