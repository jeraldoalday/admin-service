import { getDatabase } from './database';
import { ForbiddenError, NotFoundError, UnauthorizedError } from './errors';
import {
  ROLE_DEFAULT_PERMISSIONS,
  type TeamMembershipRecord,
  type TeamPermission,
  type TeamRole,
} from './types';

/**
 * The caller on whose behalf a domain action runs. It replaces the decoded JWT the Express
 * middleware used to hang off the request, and every guarded function takes one explicitly
 * rather than reading an ambient session — which is what lets the tests exercise a denial
 * without staging a login.
 */
export interface Actor {
  id: string;
  role: 'ADMIN' | 'MEMBER';
}

export function requireActor(actor: Actor | null | undefined): Actor {
  if (!actor) {
    throw new UnauthorizedError();
  }
  return actor;
}

/** Platform-level admin check, formerly `requireRole('ADMIN')`. */
export function requireAdmin(actor: Actor | null | undefined): Actor {
  const current = requireActor(actor);
  if (current.role !== 'ADMIN') {
    throw new ForbiddenError('You do not have permission to perform this action');
  }
  return current;
}

export function findMembership(teamId: string, userId: string): TeamMembershipRecord | undefined {
  return getDatabase().memberships.find(
    (membership) => membership.teamId === teamId && membership.userId === userId,
  );
}

/**
 * Team-level membership check. A non-member gets 404 rather than 403: whether a given team
 * exists is itself not public information.
 */
export function requireTeamMembership(
  actor: Actor | null | undefined,
  teamId: string,
  ...allowedRoles: TeamRole[]
): TeamMembershipRecord {
  const current = requireActor(actor);
  const membership = findMembership(teamId, current.id);

  if (!membership) {
    throw new NotFoundError('Team not found');
  }
  if (allowedRoles.length > 0 && !allowedRoles.includes(membership.role)) {
    throw new ForbiddenError('You do not have permission to perform this action');
  }
  return membership;
}

export function hasTeamPermission(
  teamId: string,
  userId: string,
  permission: TeamPermission,
  role: TeamRole,
): boolean {
  if (ROLE_DEFAULT_PERMISSIONS[role].includes(permission)) return true;
  return getDatabase().permissionGrants.some(
    (grant) =>
      grant.teamId === teamId && grant.userId === userId && grant.permission === permission,
  );
}

/**
 * Fine-grained check: the caller passes either because their team role carries the
 * permission by default or because they hold an explicit grant for it.
 */
export function requireTeamPermission(
  actor: Actor | null | undefined,
  teamId: string,
  permission: TeamPermission,
): TeamMembershipRecord {
  const membership = requireTeamMembership(actor, teamId);
  if (!hasTeamPermission(teamId, membership.userId, permission, membership.role)) {
    throw new ForbiddenError('You do not have permission to perform this action');
  }
  return membership;
}
