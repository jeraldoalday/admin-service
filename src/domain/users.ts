import { recordAuditLog } from './audit';
import { getDatabase, mutate } from './database';
import { BadRequestError, NotFoundError } from './errors';
import { requireAdmin, type Actor } from './guards';
import { nowIso } from './ids';
import { paginate, sortNewestFirst, type PaginatedResult } from './pagination';
import { promoteSuccessorsForDeactivatedOwner, reassignTeamsOwnedSolelyBy } from './teams';
import type { AdminUserView, UserRecord } from './types';
import {
  listUsersQuerySchema,
  parseInput,
  updateUserSchema,
  userFiltersSchema,
  type ListUsersQuery,
  type SortDirection,
  type UpdateUserInput,
  type UserFilters,
  type UserSortField,
} from './validation';

function toAdminUserView(user: UserRecord): AdminUserView {
  const { id, email, displayName, role, isActive, createdAt, updatedAt } = user;
  return { id, email, displayName, role, isActive, createdAt, updatedAt };
}

interface ParsedFilters {
  role?: 'ADMIN' | 'MEMBER' | undefined;
  isActive?: boolean | undefined;
  search?: string | undefined;
  sort: UserSortField;
  direction: SortDirection;
}

/**
 * Role sorts by seniority rather than alphabetically, since ADMIN before MEMBER is what
 * somebody sorting a column headed "Role" is asking for; the two happen to agree here, but
 * spelling it out keeps a third role from quietly landing in the wrong place later.
 */
const ROLE_ORDER: Record<UserRecord['role'], number> = { ADMIN: 0, MEMBER: 1 };

function compareOn(a: UserRecord, b: UserRecord, field: UserSortField): number {
  switch (field) {
    case 'displayName':
      return a.displayName.localeCompare(b.displayName);
    case 'email':
      return a.email.localeCompare(b.email);
    case 'role':
      return ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
    case 'createdAt':
      return a.createdAt.localeCompare(b.createdAt);
  }
}

/**
 * Orders the list by the requested column. Ties fall back to newest-first, so a column with
 * repeated values - every account sharing a role, say - still lands in a stable order rather
 * than whatever the table happened to hold.
 */
function sortUsers(
  users: UserRecord[],
  field: UserSortField,
  direction: SortDirection,
): UserRecord[] {
  const sign = direction === 'asc' ? 1 : -1;
  return sortNewestFirst(users).sort((a, b) => sign * compareOn(a, b, field));
}

function matchesFilters(user: UserRecord, filters: ParsedFilters): boolean {
  if (filters.role && user.role !== filters.role) return false;
  if (filters.isActive !== undefined && user.isActive !== filters.isActive) return false;

  const search = filters.search?.toLowerCase();
  if (
    search &&
    !user.email.toLowerCase().includes(search) &&
    !user.displayName.toLowerCase().includes(search)
  ) {
    return false;
  }
  return true;
}

export function listUsers(
  actor: Actor,
  rawQuery: ListUsersQuery = {},
): PaginatedResult<AdminUserView> {
  requireAdmin(actor);
  const query = parseInput(listUsersQuerySchema, rawQuery);
  const matching = getDatabase().users.filter((user) => matchesFilters(user, query));

  return paginate(sortUsers(matching, query.sort, query.direction).map(toAdminUserView), query);
}

/**
 * Every account the filters match, in one array rather than a page of them — what an export
 * needs. It shares the filters with the paged read, so the file and the screen can never
 * disagree about which accounts are in scope.
 */
export function listAllUsers(actor: Actor, rawFilters: UserFilters = {}): AdminUserView[] {
  requireAdmin(actor);
  const filters = parseInput(userFiltersSchema, rawFilters);
  const matching = getDatabase().users.filter((user) => matchesFilters(user, filters));

  return sortUsers(matching, filters.sort, filters.direction).map(toAdminUserView);
}

function getUserRecordOrThrow(id: string): UserRecord {
  const user = getDatabase().users.find((candidate) => candidate.id === id);
  if (!user) {
    throw new NotFoundError('User not found');
  }
  return user;
}

export function updateUser(actor: Actor, id: string, rawInput: UpdateUserInput): AdminUserView {
  const admin = requireAdmin(actor);
  const input = parseInput(updateUserSchema, rawInput);

  // Guard against locking yourself out of the console you are standing in.
  if (id === admin.id && (input.role !== undefined || input.isActive === false)) {
    throw new BadRequestError(
      'Admins cannot change their own role or deactivate their own account',
    );
  }

  const existing = getUserRecordOrThrow(id);
  const isDeactivating = input.isActive === false && existing.isActive;

  const updated = mutate(() => {
    if (input.displayName !== undefined) existing.displayName = input.displayName;
    if (input.role !== undefined) existing.role = input.role;
    if (input.isActive !== undefined) existing.isActive = input.isActive;
    existing.updatedAt = nowIso();
    return toAdminUserView(existing);
  });

  // A deactivated account cannot sign in, which leaves any team it solely owned with nobody
  // able to act on it until it is reactivated. Give such a team a second owner now, the same
  // way deleting the account would hand it over for good — see promoteSuccessorsForDeactivatedOwner.
  const reassignments = isDeactivating ? promoteSuccessorsForDeactivatedOwner(admin.id, id) : [];

  recordAuditLog({
    actorId: admin.id,
    action: 'user.updated',
    targetType: 'user',
    targetId: id,
    metadata: reassignments.length > 0 ? { ...input, reassignedTeams: reassignments } : input,
  });

  return updated;
}

/**
 * Deletes a user along with the rows the SQLite schema used to cascade away for us — the
 * team memberships and permission grants keyed to them. Invites are addressed to an email
 * rather than a user id and are deliberately left alone, exactly as before.
 *
 * Any team the account was the only owner of is handed to the member left longest behind
 * first, so the deletion cannot strand a team with nobody able to administer it.
 */
export function deleteUser(actor: Actor, id: string): void {
  const admin = requireAdmin(actor);

  if (id === admin.id) {
    throw new BadRequestError('Admins cannot delete their own account');
  }

  getUserRecordOrThrow(id);
  const reassignments = reassignTeamsOwnedSolelyBy(admin.id, id);

  mutate((db) => {
    db.users = db.users.filter((candidate) => candidate.id !== id);
    db.memberships = db.memberships.filter((membership) => membership.userId !== id);
    db.permissionGrants = db.permissionGrants.filter((grant) => grant.userId !== id);
  });

  recordAuditLog({
    actorId: admin.id,
    action: 'user.deleted',
    targetType: 'user',
    targetId: id,
    ...(reassignments.length > 0 ? { metadata: { reassignedTeams: reassignments } } : {}),
  });
}
