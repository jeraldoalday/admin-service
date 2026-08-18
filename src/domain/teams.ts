import { recordAuditLog } from './audit';
import { getDatabase, mutate } from './database';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from './errors';
import {
  findMembership,
  requireActor,
  requireTeamMembership,
  requireTeamPermission,
  type Actor,
} from './guards';
import { createId, createToken, nowIso } from './ids';
import { paginate, sortNewestFirst, sortOldestFirst, type PaginatedResult } from './pagination';
import type {
  TeamInviteRecord,
  TeamInviteView,
  TeamMemberView,
  TeamRecord,
  TeamRole,
  TeamView,
  TeamWithRole,
} from './types';
import {
  createInviteSchema,
  createTeamSchema,
  listInvitesQuerySchema,
  paginationSchema,
  parseInput,
  updateMemberRoleSchema,
  updateTeamSchema,
  type CreateInviteInput,
  type CreateTeamInput,
  type ListInvitesQuery,
  type UpdateTeamInput,
} from './validation';

/** Invites are single-use and expire a week after they are issued. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function toTeamView(team: TeamRecord): TeamView {
  const { id, name, slug, createdAt, updatedAt } = team;
  return { id, name, slug, createdAt, updatedAt };
}

function toInviteView(invite: TeamInviteRecord): TeamInviteView {
  const { id, teamId, email, role, status, token, expiresAt, createdAt } = invite;
  return { id, teamId, email, role, status, token, expiresAt, createdAt };
}

function getTeamRecordOrThrow(teamId: string): TeamRecord {
  const team = getDatabase().teams.find((candidate) => candidate.id === teamId);
  if (!team) {
    throw new NotFoundError('Team not found');
  }
  return team;
}

function countOwners(teamId: string): number {
  return getDatabase().memberships.filter(
    (membership) => membership.teamId === teamId && membership.role === 'OWNER',
  ).length;
}

/** Any signed-in user can start a team, and becomes its first OWNER. */
export function createTeam(actor: Actor, rawInput: CreateTeamInput): TeamWithRole {
  const current = requireActor(actor);
  const input = parseInput(createTeamSchema, rawInput);

  const baseSlug = slugify(input.name) || 'team';
  const slugTaken = getDatabase().teams.some((team) => team.slug === baseSlug);
  const slug = slugTaken ? `${baseSlug}-${createToken(3)}` : baseSlug;

  const team = mutate((db) => {
    const timestamp = nowIso();
    const record: TeamRecord = {
      id: createId(),
      name: input.name,
      slug,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    db.teams.push(record);
    db.memberships.push({
      id: createId(),
      teamId: record.id,
      userId: current.id,
      role: 'OWNER',
      createdAt: timestamp,
    });
    return record;
  });

  recordAuditLog({
    actorId: current.id,
    action: 'team.created',
    targetType: 'team',
    targetId: team.id,
    metadata: { name: team.name, slug: team.slug },
  });

  return { ...toTeamView(team), role: 'OWNER' };
}

export function listTeamsForUser(
  actor: Actor,
  rawQuery: { page?: number; pageSize?: number } = {},
): PaginatedResult<TeamWithRole> {
  const current = requireActor(actor);
  const query = parseInput(paginationSchema, rawQuery);

  const memberships = sortNewestFirst(
    getDatabase().memberships.filter((membership) => membership.userId === current.id),
  );

  const items = memberships.flatMap((membership) => {
    const team = getDatabase().teams.find((candidate) => candidate.id === membership.teamId);
    return team ? [{ ...toTeamView(team), role: membership.role }] : [];
  });

  return paginate(items, query);
}

export function getTeam(actor: Actor, teamId: string): TeamWithRole {
  const membership = requireTeamMembership(actor, teamId);
  return { ...toTeamView(getTeamRecordOrThrow(teamId)), role: membership.role };
}

export function updateTeam(actor: Actor, teamId: string, rawInput: UpdateTeamInput): TeamView {
  const current = requireActor(actor);
  requireTeamPermission(actor, teamId, 'MANAGE_TEAM');
  const input = parseInput(updateTeamSchema, rawInput);
  const team = getTeamRecordOrThrow(teamId);

  const updated = mutate(() => {
    team.name = input.name;
    team.updatedAt = nowIso();
    return toTeamView(team);
  });

  recordAuditLog({
    actorId: current.id,
    action: 'team.updated',
    targetType: 'team',
    targetId: teamId,
    metadata: { name: input.name },
  });

  return updated;
}

/** Deleting a team stays OWNER-only — deliberately outside the grantable permission set. */
export function deleteTeam(actor: Actor, teamId: string): void {
  const current = requireActor(actor);
  requireTeamMembership(actor, teamId, 'OWNER');
  getTeamRecordOrThrow(teamId);

  mutate((db) => {
    db.teams = db.teams.filter((team) => team.id !== teamId);
    db.memberships = db.memberships.filter((membership) => membership.teamId !== teamId);
    db.invites = db.invites.filter((invite) => invite.teamId !== teamId);
    db.permissionGrants = db.permissionGrants.filter((grant) => grant.teamId !== teamId);
    db.apiKeys = db.apiKeys.filter((key) => key.teamId !== teamId);
  });

  recordAuditLog({
    actorId: current.id,
    action: 'team.deleted',
    targetType: 'team',
    targetId: teamId,
  });
}

/**
 * Unguarded member read, shared by the member-facing listing and the API-key-authenticated
 * service read — the two differ only in how the caller proves they may see the team.
 */
export function readTeamMembers(
  teamId: string,
  rawQuery: { page?: number; pageSize?: number } = {},
): PaginatedResult<TeamMemberView> {
  const query = parseInput(paginationSchema, rawQuery);

  const memberships = sortOldestFirst(
    getDatabase().memberships.filter((membership) => membership.teamId === teamId),
  );

  const items = memberships.flatMap((membership) => {
    const user = getDatabase().users.find((candidate) => candidate.id === membership.userId);
    if (!user) return [];
    return [
      {
        userId: membership.userId,
        email: user.email,
        displayName: user.displayName,
        role: membership.role,
        createdAt: membership.createdAt,
      },
    ];
  });

  return paginate(items, query);
}

export function listTeamMembers(
  actor: Actor,
  teamId: string,
  rawQuery: { page?: number; pageSize?: number } = {},
): PaginatedResult<TeamMemberView> {
  requireTeamMembership(actor, teamId);
  return readTeamMembers(teamId, rawQuery);
}

export function updateMemberRole(
  actor: Actor,
  teamId: string,
  targetUserId: string,
  rawRole: TeamRole,
): TeamMemberView {
  const current = requireActor(actor);
  requireTeamPermission(actor, teamId, 'MANAGE_MEMBERS');
  const { role } = parseInput(updateMemberRoleSchema, { role: rawRole });

  const membership = findMembership(teamId, targetUserId);
  if (!membership) {
    throw new NotFoundError('Team member not found');
  }

  if (membership.role === 'OWNER' && role !== 'OWNER' && countOwners(teamId) <= 1) {
    throw new BadRequestError('A team must have at least one owner');
  }

  const user = getDatabase().users.find((candidate) => candidate.id === targetUserId);
  if (!user) {
    throw new NotFoundError('Team member not found');
  }

  const updated = mutate(() => {
    membership.role = role;
    return {
      userId: membership.userId,
      email: user.email,
      displayName: user.displayName,
      role: membership.role,
      createdAt: membership.createdAt,
    };
  });

  recordAuditLog({
    actorId: current.id,
    action: 'team.member.role_updated',
    targetType: 'team_membership',
    targetId: `${teamId}:${targetUserId}`,
    metadata: { role },
  });

  return updated;
}

/**
 * Removes a member and clears their permission grants, so a later re-invite starts from a
 * clean slate instead of silently restoring the access they had before they left.
 */
export function removeMember(actor: Actor, teamId: string, targetUserId: string): void {
  const current = requireActor(actor);
  requireTeamPermission(actor, teamId, 'MANAGE_MEMBERS');

  const membership = findMembership(teamId, targetUserId);
  if (!membership) {
    throw new NotFoundError('Team member not found');
  }
  if (membership.role === 'OWNER' && countOwners(teamId) <= 1) {
    throw new BadRequestError('A team must have at least one owner');
  }

  mutate((db) => {
    db.memberships = db.memberships.filter((candidate) => candidate.id !== membership.id);
    db.permissionGrants = db.permissionGrants.filter(
      (grant) => !(grant.teamId === teamId && grant.userId === targetUserId),
    );
  });

  recordAuditLog({
    actorId: current.id,
    action: 'team.member.removed',
    targetType: 'team_membership',
    targetId: `${teamId}:${targetUserId}`,
  });
}

export function leaveTeam(actor: Actor, teamId: string): void {
  const current = requireActor(actor);
  const membership = requireTeamMembership(actor, teamId);

  if (membership.role === 'OWNER' && countOwners(teamId) <= 1) {
    throw new BadRequestError(
      'The last owner cannot leave the team; transfer ownership or delete the team first',
    );
  }

  mutate((db) => {
    db.memberships = db.memberships.filter((candidate) => candidate.id !== membership.id);
    db.permissionGrants = db.permissionGrants.filter(
      (grant) => !(grant.teamId === teamId && grant.userId === current.id),
    );
  });

  recordAuditLog({
    actorId: current.id,
    action: 'team.member.left',
    targetType: 'team_membership',
    targetId: `${teamId}:${current.id}`,
  });
}

export function createInvite(
  actor: Actor,
  teamId: string,
  rawInput: CreateInviteInput,
): TeamInviteView {
  const current = requireActor(actor);
  requireTeamPermission(actor, teamId, 'MANAGE_INVITES');
  const input = parseInput(createInviteSchema, rawInput);

  const alreadyMember = getDatabase().memberships.some((membership) => {
    if (membership.teamId !== teamId) return false;
    const user = getDatabase().users.find((candidate) => candidate.id === membership.userId);
    return user?.email === input.email;
  });
  if (alreadyMember) {
    throw new ConflictError('This person is already a member of the team');
  }

  const pendingInvite = getDatabase().invites.find(
    (invite) =>
      invite.teamId === teamId &&
      invite.email === input.email &&
      invite.status === 'PENDING' &&
      Date.parse(invite.expiresAt) > Date.now(),
  );
  if (pendingInvite) {
    throw new ConflictError('There is already a pending invite for this email');
  }

  const invite = mutate((db) => {
    const record: TeamInviteRecord = {
      id: createId(),
      teamId,
      email: input.email,
      role: input.role,
      token: createToken(),
      status: 'PENDING',
      invitedById: current.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS).toISOString(),
      createdAt: nowIso(),
    };
    db.invites.push(record);
    return record;
  });

  recordAuditLog({
    actorId: current.id,
    action: 'team.invite.created',
    targetType: 'team_invite',
    targetId: invite.id,
    metadata: { email: invite.email, role: invite.role },
  });

  return toInviteView(invite);
}

export function listInvites(
  actor: Actor,
  teamId: string,
  rawQuery: ListInvitesQuery = {},
): PaginatedResult<TeamInviteView> {
  requireTeamPermission(actor, teamId, 'MANAGE_INVITES');
  const query = parseInput(listInvitesQuerySchema, rawQuery);

  const matching = getDatabase().invites.filter(
    (invite) => invite.teamId === teamId && (!query.status || invite.status === query.status),
  );

  return paginate(sortNewestFirst(matching).map(toInviteView), query);
}

export function revokeInvite(actor: Actor, teamId: string, inviteId: string): void {
  const current = requireActor(actor);
  requireTeamPermission(actor, teamId, 'MANAGE_INVITES');

  const invite = getDatabase().invites.find((candidate) => candidate.id === inviteId);
  if (!invite || invite.teamId !== teamId) {
    throw new NotFoundError('Invite not found');
  }
  if (invite.status !== 'PENDING') {
    throw new BadRequestError('Only pending invites can be revoked');
  }

  mutate(() => {
    invite.status = 'REVOKED';
  });

  recordAuditLog({
    actorId: current.id,
    action: 'team.invite.revoked',
    targetType: 'team_invite',
    targetId: inviteId,
  });
}

/** Looks up an invite by its token without accepting it, so the UI can preview it. */
export function findInviteByToken(token: string): TeamInviteView | null {
  const invite = getDatabase().invites.find((candidate) => candidate.token === token);
  return invite ? toInviteView(invite) : null;
}

export function acceptInvite(actor: Actor, token: string): TeamWithRole {
  const current = requireActor(actor);

  const invite = getDatabase().invites.find((candidate) => candidate.token === token);
  if (!invite) {
    throw new NotFoundError('Invite not found');
  }

  const user = getDatabase().users.find((candidate) => candidate.id === current.id);
  if (!user) {
    throw new NotFoundError('User not found');
  }

  // A pending invite that has aged out is flipped to EXPIRED on the way past, so the list
  // reflects reality rather than waiting for a sweep that never runs.
  const isExpired =
    invite.status === 'EXPIRED' ||
    (invite.status === 'PENDING' && Date.parse(invite.expiresAt) < Date.now());
  if (isExpired) {
    if (invite.status === 'PENDING') {
      mutate(() => {
        invite.status = 'EXPIRED';
      });
    }
    throw new BadRequestError('This invite has expired');
  }

  if (invite.status !== 'PENDING') {
    throw new BadRequestError('This invite is no longer valid');
  }

  if (invite.email !== user.email) {
    throw new ForbiddenError('This invite was issued to a different email address');
  }

  const team = getTeamRecordOrThrow(invite.teamId);

  mutate((db) => {
    const existing = findMembership(invite.teamId, current.id);
    if (!existing) {
      db.memberships.push({
        id: createId(),
        teamId: invite.teamId,
        userId: current.id,
        role: invite.role,
        createdAt: nowIso(),
      });
    }
    invite.status = 'ACCEPTED';
  });

  recordAuditLog({
    actorId: current.id,
    action: 'team.invite.accepted',
    targetType: 'team_invite',
    targetId: invite.id,
    metadata: { teamId: invite.teamId, role: invite.role },
  });

  return { ...toTeamView(team), role: invite.role };
}
