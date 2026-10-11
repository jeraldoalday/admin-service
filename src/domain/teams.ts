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
import { getOwnPermissions } from './permissions';
import {
  ROLE_DEFAULT_PERMISSIONS,
  type InviteStatus,
  type TeamInviteRecord,
  type TeamInviteView,
  type TeamMemberView,
  type TeamMembershipRecord,
  type TeamRecord,
  type TeamRole,
  type TeamView,
  type TeamWithRole,
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

/**
 * The status an invite actually has right now, rather than the one last written to it.
 *
 * A pending invite whose window has closed is already dead — presenting the token is refused
 * — but nothing sweeps the tables to say so, so the stored row keeps reading PENDING until
 * someone tries to accept it. Deriving the status on read is what keeps a screen honest:
 * the row shows as expired, and the controls that only make sense for a live invite (its
 * link, revoking it) stop being offered for one that can no longer be redeemed.
 */
export function effectiveInviteStatus(invite: TeamInviteRecord): InviteStatus {
  if (invite.status === 'PENDING' && Date.parse(invite.expiresAt) <= Date.now()) {
    return 'EXPIRED';
  }
  return invite.status;
}

function toInviteView(invite: TeamInviteRecord): TeamInviteView {
  const { id, teamId, email, role, token, expiresAt, createdAt } = invite;
  return {
    id,
    teamId,
    email,
    role,
    status: effectiveInviteStatus(invite),
    token,
    expiresAt,
    createdAt,
  };
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
    teamId: team.id,
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
    teamId,
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
    teamId,
  });
}

/**
 * Flips every pending invite whose window has closed to EXPIRED, and reports how many moved.
 *
 * Reads already derive this, so nothing on screen depends on the sweep having run. What it
 * fixes is the stored rows drifting from the truth the screens show: the tables outlive the
 * session that wrote them, and a row that still says PENDING a month after it died is a
 * liability for anything that reads the database without going through the domain — an
 * export, a migration, a future consumer. Running it once at boot is enough, since an invite
 * issued during a session cannot outlive it by much.
 */
export function expireStaleInvites(now = Date.now()): number {
  const stale = getDatabase().invites.filter(
    (invite) => invite.status === 'PENDING' && Date.parse(invite.expiresAt) <= now,
  );
  if (stale.length === 0) return 0;

  mutate(() => {
    stale.forEach((invite) => {
      invite.status = 'EXPIRED';
    });
  });

  return stale.length;
}

export interface OwnershipReassignment {
  teamId: string;
  /** The member promoted to OWNER, or null when the team had nobody left and was deleted. */
  newOwnerId: string | null;
}

/** Every team `userId` is the sole OWNER of. */
function soleOwnershipsOf(userId: string): TeamMembershipRecord[] {
  return getDatabase().memberships.filter(
    (membership) =>
      membership.userId === userId &&
      membership.role === 'OWNER' &&
      countOwners(membership.teamId) === 1,
  );
}

/**
 * The member best placed to take over as OWNER, preferring a team ADMIN over a plain MEMBER
 * since they already hold the permissions the role carries, and otherwise the longest-standing
 * member — or `undefined` when `excludeUserId` was the only person on the team.
 */
function findOwnerSuccessor(
  teamId: string,
  excludeUserId: string,
): TeamMembershipRecord | undefined {
  return getDatabase()
    .memberships.filter(
      (membership) => membership.teamId === teamId && membership.userId !== excludeUserId,
    )
    .sort((a, b) => {
      if (a.role !== b.role) return a.role === 'ADMIN' ? -1 : 1;
      return a.createdAt.localeCompare(b.createdAt);
    })[0];
}

/**
 * Keeps every team owned when a user leaves the platform.
 *
 * Deleting a user used to drop their memberships wholesale, which quietly stranded any team
 * they were the only owner of: a team with no owner cannot be renamed, cannot be deleted, and
 * cannot promote anybody, so the rules that protect the last owner turned into a trap the
 * moment that owner's account went away. The longest-standing member left behind is promoted
 * instead, preferring a team ADMIN over a plain MEMBER since they already hold the
 * permissions the role carries. A team with nobody left is deleted along with its rows —
 * there is no one to hand it to, and an empty team is not a thing anyone can reach.
 *
 * Unguarded on purpose: it runs inside the admin-guarded delete, and takes the acting admin
 * so the entries it writes are attributed to the person who caused them.
 */
export function reassignTeamsOwnedSolelyBy(
  actorId: string,
  userId: string,
): OwnershipReassignment[] {
  return soleOwnershipsOf(userId).map((ownership) => {
    const teamId = ownership.teamId;
    const successor = findOwnerSuccessor(teamId, userId);

    if (!successor) {
      mutate((db) => {
        db.teams = db.teams.filter((team) => team.id !== teamId);
        db.memberships = db.memberships.filter((membership) => membership.teamId !== teamId);
        db.invites = db.invites.filter((invite) => invite.teamId !== teamId);
        db.permissionGrants = db.permissionGrants.filter((grant) => grant.teamId !== teamId);
        db.apiKeys = db.apiKeys.filter((key) => key.teamId !== teamId);
      });

      recordAuditLog({
        actorId,
        action: 'team.deleted',
        targetType: 'team',
        targetId: teamId,
        teamId,
        metadata: { reason: 'last_owner_deleted' },
      });

      return { teamId, newOwnerId: null };
    }

    mutate(() => {
      successor.role = 'OWNER';
    });

    recordAuditLog({
      actorId,
      action: 'team.member.role_updated',
      targetType: 'team_membership',
      targetId: `${teamId}:${successor.userId}`,
      teamId,
      metadata: { role: 'OWNER', reason: 'previous_owner_deleted' },
    });

    return { teamId, newOwnerId: successor.userId };
  });
}

/**
 * Gives a team a second owner when deactivating an account would otherwise leave it with none
 * it can reach.
 *
 * Deactivation, unlike deletion, is not final — the account can be reactivated later — so a
 * team the deactivated user solely owned is not deleted for want of a successor the way
 * {@link reassignTeamsOwnedSolelyBy} deletes one: there would be no way back for a team that
 * turned out to matter. Where another member exists, they are promoted alongside the existing
 * owner (rather than in their place, since the deactivation might not stick) so the team keeps
 * someone able to act on it. Where nobody else is on the team, it is left exactly as it was;
 * the sole owner regains it the moment they are reactivated.
 *
 * Unguarded on purpose: it runs inside the admin-guarded update, and takes the acting admin so
 * the entries it writes are attributed to the person who caused them.
 */
export function promoteSuccessorsForDeactivatedOwner(
  actorId: string,
  userId: string,
): OwnershipReassignment[] {
  const reassignments: OwnershipReassignment[] = [];

  soleOwnershipsOf(userId).forEach((ownership) => {
    const teamId = ownership.teamId;
    const successor = findOwnerSuccessor(teamId, userId);
    if (!successor) return;

    mutate(() => {
      successor.role = 'OWNER';
    });

    recordAuditLog({
      actorId,
      action: 'team.member.role_updated',
      targetType: 'team_membership',
      targetId: `${teamId}:${successor.userId}`,
      teamId,
      metadata: { role: 'OWNER', reason: 'owner_deactivated' },
    });

    reassignments.push({ teamId, newOwnerId: successor.userId });
  });

  return reassignments;
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
  const actorMembership = requireTeamPermission(actor, teamId, 'MANAGE_MEMBERS');
  const { role } = parseInput(updateMemberRoleSchema, { role: rawRole });

  const membership = findMembership(teamId, targetUserId);
  if (!membership) {
    throw new NotFoundError('Team member not found');
  }

  // MANAGE_MEMBERS is held by ADMIN by default (and can be granted to a plain MEMBER), but
  // promoting someone to OWNER is a step up in power those roles don't otherwise carry —
  // without this, an ADMIN could hand OWNER to themselves or anyone else on the team.
  if (role === 'OWNER' && actorMembership.role !== 'OWNER') {
    throw new ForbiddenError('Only an owner can promote a member to owner');
  }

  // ADMIN carries every one of the five grantable permissions by default, so promoting
  // someone to it is the same step up in power as granting all five directly — without
  // this, a MEMBER holding only MANAGE_MEMBERS (their own grant, or someone else's) could
  // promote anyone, including themselves, to ADMIN and gain the other four despite holding
  // only one, the same shape of gap already closed around granting a permission directly
  // (setMemberPermissionGrants) and scoping an API key (createApiKey, rotateApiKey).
  if (role === 'ADMIN') {
    const actorPermissions = getOwnPermissions(actor, teamId).effectivePermissions;
    const beyondActor = ROLE_DEFAULT_PERMISSIONS.ADMIN.filter(
      (permission) => !actorPermissions.includes(permission),
    );
    if (beyondActor.length > 0) {
      throw new ForbiddenError(
        `You cannot promote a member to a role that carries a permission you do not hold yourself: ${beyondActor.join(', ')}`,
      );
    }
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
    teamId,
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
    teamId,
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
    teamId,
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
    teamId,
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
    (invite) =>
      invite.teamId === teamId && (!query.status || effectiveInviteStatus(invite) === query.status),
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

  // The derived status, not the stored one: a row that aged out still reads PENDING until
  // something settles it, and revoking it would have overwritten a true EXPIRED with a
  // REVOKED that never happened — a rewrite of history rather than a record of it. As on
  // acceptance, the row is settled on the way past so the next reader sees the truth.
  const status = effectiveInviteStatus(invite);
  if (status === 'EXPIRED') {
    if (invite.status === 'PENDING') {
      mutate(() => {
        invite.status = 'EXPIRED';
      });
    }
    throw new BadRequestError('This invite has already expired');
  }
  if (status !== 'PENDING') {
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
    teamId,
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

  // A pending invite that has aged out is flipped to EXPIRED on the way past, so the stored
  // row catches up with what readers were already being shown.
  const status = effectiveInviteStatus(invite);
  if (status === 'EXPIRED') {
    if (invite.status === 'PENDING') {
      mutate(() => {
        invite.status = 'EXPIRED';
      });
    }
    throw new BadRequestError('This invite has expired');
  }

  if (status !== 'PENDING') {
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
    teamId: invite.teamId,
    metadata: { role: invite.role },
  });

  return { ...toTeamView(team), role: invite.role };
}
