import { recordAuditLog } from './audit';
import { getDatabase, mutate } from './database';
import { NotFoundError } from './errors';
import { findMembership, requireActor, requireTeamPermission, type Actor } from './guards';
import { createId, nowIso } from './ids';
import {
  ROLE_DEFAULT_PERMISSIONS,
  type EffectivePermissions,
  type TeamPermission,
  type TeamRole,
} from './types';
import { parseInput, setMemberPermissionsSchema } from './validation';

/**
 * Grants are additive: they extend what a member can do but can never take away what their
 * team role already carries, which is why the effective set is a union rather than an
 * override.
 */
function mergePermissions(role: TeamRole, granted: TeamPermission[]): EffectivePermissions {
  const rolePermissions = ROLE_DEFAULT_PERMISSIONS[role];
  return {
    role,
    rolePermissions,
    grantedPermissions: granted,
    effectivePermissions: [...new Set([...rolePermissions, ...granted])],
  };
}

function getMembershipOrThrow(teamId: string, userId: string): { role: TeamRole } {
  const membership = findMembership(teamId, userId);
  if (!membership) {
    throw new NotFoundError('Team member not found');
  }
  return membership;
}

function grantsFor(teamId: string, userId: string): TeamPermission[] {
  return getDatabase()
    .permissionGrants.filter((grant) => grant.teamId === teamId && grant.userId === userId)
    .map((grant) => grant.permission);
}

export function getEffectivePermissions(
  actor: Actor,
  teamId: string,
  userId: string,
): EffectivePermissions {
  requireTeamPermission(actor, teamId, 'MANAGE_PERMISSIONS');
  const membership = getMembershipOrThrow(teamId, userId);
  return mergePermissions(membership.role, grantsFor(teamId, userId));
}

/**
 * Reads the caller's own effective permissions without requiring MANAGE_PERMISSIONS — the UI
 * needs this on every team screen to decide which controls to render.
 */
export function getOwnPermissions(actor: Actor, teamId: string): EffectivePermissions {
  const current = requireActor(actor);
  const membership = getMembershipOrThrow(teamId, current.id);
  return mergePermissions(membership.role, grantsFor(teamId, current.id));
}

/** Replaces a member's grants wholesale, mirroring the PUT semantics of the old endpoint. */
export function setMemberPermissionGrants(
  actor: Actor,
  teamId: string,
  userId: string,
  permissions: TeamPermission[],
): EffectivePermissions {
  const current = requireActor(actor);
  requireTeamPermission(actor, teamId, 'MANAGE_PERMISSIONS');
  const input = parseInput(setMemberPermissionsSchema, { permissions });
  const membership = getMembershipOrThrow(teamId, userId);
  const unique = [...new Set(input.permissions)];

  mutate((db) => {
    db.permissionGrants = db.permissionGrants.filter(
      (grant) => !(grant.teamId === teamId && grant.userId === userId),
    );
    unique.forEach((permission) => {
      db.permissionGrants.push({
        id: createId(),
        teamId,
        userId,
        permission,
        createdAt: nowIso(),
      });
    });
  });

  recordAuditLog({
    actorId: current.id,
    action: 'team.member.permissions_updated',
    targetType: 'team_membership',
    targetId: `${teamId}:${userId}`,
    teamId,
    metadata: { permissions: unique },
  });

  return mergePermissions(membership.role, unique);
}
