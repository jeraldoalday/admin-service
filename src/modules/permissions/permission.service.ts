import { prisma } from '../../db/prisma.js';
import { NotFoundError } from '../../common/errors.js';
import type { TeamPermission, TeamRole } from '../../generated/prisma/enums.js';
import { ROLE_DEFAULT_PERMISSIONS } from './permission.constants.js';

export interface EffectivePermissions {
  role: TeamRole;
  rolePermissions: TeamPermission[];
  grantedPermissions: TeamPermission[];
  effectivePermissions: TeamPermission[];
}

function mergePermissions(role: TeamRole, granted: TeamPermission[]): EffectivePermissions {
  const rolePermissions = ROLE_DEFAULT_PERMISSIONS[role];
  const effectiveSet = new Set<TeamPermission>([...rolePermissions, ...granted]);
  return {
    role,
    rolePermissions,
    grantedPermissions: granted,
    effectivePermissions: [...effectiveSet],
  };
}

async function getMembershipOrThrow(
  teamId: string,
  userId: string,
): Promise<{ role: TeamRole }> {
  const membership = await prisma.teamMembership.findUnique({
    where: { teamId_userId: { teamId, userId } },
  });
  if (!membership) {
    throw new NotFoundError('Team member not found');
  }
  return membership;
}

export async function getEffectivePermissions(
  teamId: string,
  userId: string,
): Promise<EffectivePermissions> {
  const membership = await getMembershipOrThrow(teamId, userId);
  const grants = await prisma.teamPermissionGrant.findMany({
    where: { teamId, userId },
    select: { permission: true },
  });
  return mergePermissions(
    membership.role,
    grants.map((g) => g.permission),
  );
}

export async function setMemberPermissionGrants(
  teamId: string,
  userId: string,
  permissions: TeamPermission[],
): Promise<EffectivePermissions> {
  const membership = await getMembershipOrThrow(teamId, userId);
  const unique = [...new Set(permissions)];

  await prisma.$transaction([
    prisma.teamPermissionGrant.deleteMany({ where: { teamId, userId } }),
    ...unique.map((permission) =>
      prisma.teamPermissionGrant.create({ data: { teamId, userId, permission } }),
    ),
  ]);

  return mergePermissions(membership.role, unique);
}
