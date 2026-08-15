import type { TeamPermission, TeamRole } from '../../generated/prisma/enums.js';

export const TEAM_PERMISSIONS: TeamPermission[] = [
  'MANAGE_TEAM',
  'MANAGE_MEMBERS',
  'MANAGE_INVITES',
  'MANAGE_PERMISSIONS',
  'MANAGE_API_KEYS',
];

// Permissions every member of a role has by default, independent of any grants.
// OWNER and ADMIN start out equally capable (mirrors the pre-existing route guards);
// team deletion stays a hardcoded OWNER-only check and is not part of this permission set.
export const ROLE_DEFAULT_PERMISSIONS: Record<TeamRole, TeamPermission[]> = {
  OWNER: [...TEAM_PERMISSIONS],
  ADMIN: [...TEAM_PERMISSIONS],
  MEMBER: [],
};
