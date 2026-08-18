/**
 * Entity types for the admin console.
 *
 * These mirror the shapes the service previously persisted with Prisma. Timestamps are
 * ISO-8601 strings rather than `Date` objects so that records survive a round trip through
 * `JSON.stringify`/`localStorage` without a revival step.
 */

export type UserRole = 'ADMIN' | 'MEMBER';
export const USER_ROLES: UserRole[] = ['ADMIN', 'MEMBER'];

export type TeamRole = 'OWNER' | 'ADMIN' | 'MEMBER';
export const TEAM_ROLES: TeamRole[] = ['OWNER', 'ADMIN', 'MEMBER'];

export type InviteStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
export const INVITE_STATUSES: InviteStatus[] = ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'];

export type TeamPermission =
  'MANAGE_TEAM' | 'MANAGE_MEMBERS' | 'MANAGE_INVITES' | 'MANAGE_PERMISSIONS' | 'MANAGE_API_KEYS';

export const TEAM_PERMISSIONS: TeamPermission[] = [
  'MANAGE_TEAM',
  'MANAGE_MEMBERS',
  'MANAGE_INVITES',
  'MANAGE_PERMISSIONS',
  'MANAGE_API_KEYS',
];

/**
 * Permissions every member of a role has by default, independent of any grants.
 * OWNER and ADMIN start out equally capable; team deletion stays a hardcoded OWNER-only
 * check and is deliberately not part of this permission set.
 */
export const ROLE_DEFAULT_PERMISSIONS: Record<TeamRole, TeamPermission[]> = {
  OWNER: [...TEAM_PERMISSIONS],
  ADMIN: [...TEAM_PERMISSIONS],
  MEMBER: [],
};

export type ApiKeyStatus = 'ACTIVE' | 'REVOKED';
export const API_KEY_STATUSES: ApiKeyStatus[] = ['ACTIVE', 'REVOKED'];

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TeamRecord {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamMembershipRecord {
  id: string;
  teamId: string;
  userId: string;
  role: TeamRole;
  createdAt: string;
}

export interface TeamInviteRecord {
  id: string;
  teamId: string;
  email: string;
  role: TeamRole;
  token: string;
  status: InviteStatus;
  invitedById: string;
  expiresAt: string;
  createdAt: string;
}

export interface TeamPermissionGrantRecord {
  id: string;
  teamId: string;
  userId: string;
  permission: TeamPermission;
  createdAt: string;
}

export interface ApiKeyRecord {
  id: string;
  teamId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  permissions: TeamPermission[];
  status: ApiKeyStatus;
  createdById: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogRecord {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/** Public projection of a user — never carries the password hash. */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
}

/** Admin-facing projection, which additionally exposes account status. */
export interface AdminUserView extends PublicUser {
  isActive: boolean;
  updatedAt: string;
}

export interface TeamView {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface TeamWithRole extends TeamView {
  role: TeamRole;
}

export interface TeamMemberView {
  userId: string;
  email: string;
  displayName: string;
  role: TeamRole;
  createdAt: string;
}

export interface TeamInviteView {
  id: string;
  teamId: string;
  email: string;
  role: TeamRole;
  status: InviteStatus;
  token: string;
  expiresAt: string;
  createdAt: string;
}

export interface EffectivePermissions {
  role: TeamRole;
  rolePermissions: TeamPermission[];
  grantedPermissions: TeamPermission[];
  effectivePermissions: TeamPermission[];
}

/** API key projection — the plaintext secret is never part of it. */
export interface ApiKeyView {
  id: string;
  teamId: string;
  name: string;
  keyPrefix: string;
  permissions: TeamPermission[];
  status: ApiKeyStatus;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLogView {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
