import { recordAuditLog } from './audit';
import { getDatabase, mutate } from './database';
import { ForbiddenError, NotFoundError } from './errors';
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
  const actorMembership = requireTeamPermission(actor, teamId, 'MANAGE_PERMISSIONS');
  const input = parseInput(setMemberPermissionsSchema, { permissions });
  const membership = getMembershipOrThrow(teamId, userId);
  const unique = [...new Set(input.permissions)];

  // MANAGE_PERMISSIONS lets a caller edit grants, but not hand out power they do not hold
  // themselves — without this, a MEMBER granted only MANAGE_PERMISSIONS could grant themselves
  // (or anyone else) the other four permissions and end up with an ADMIN's access despite never
  // holding it, the same shape of gap MANAGE_MEMBERS alone left around OWNER promotion. Already
  // having a permission on the books, granted earlier by someone who did hold it, is left alone:
  // this only blocks a caller from newly adding one they cannot themselves grant.
  const actorPermissions = mergePermissions(
    actorMembership.role,
    grantsFor(teamId, current.id),
  ).effectivePermissions;
  const alreadyGranted = grantsFor(teamId, userId);
  const beyondActor = unique.filter(
    (permission) => !actorPermissions.includes(permission) && !alreadyGranted.includes(permission),
  );
  if (beyondActor.length > 0) {
    throw new ForbiddenError(
      `You cannot grant a permission you do not hold yourself: ${beyondActor.join(', ')}`,
    );
  }

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
