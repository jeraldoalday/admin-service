import { recordAuditLog } from './audit';
import { getDatabase, mutate } from './database';
import { BadRequestError, NotFoundError } from './errors';
import { requireAdmin, type Actor } from './guards';
import { nowIso } from './ids';
import { paginate, sortNewestFirst, type PaginatedResult } from './pagination';
import { reassignTeamsOwnedSolelyBy } from './teams';
import type { AdminUserView, UserRecord } from './types';
import {
  listUsersQuerySchema,
  parseInput,
  updateUserSchema,
  userFiltersSchema,
  type ListUsersQuery,
  type UpdateUserInput,
  type UserFilters,
} from './validation';

function toAdminUserView(user: UserRecord): AdminUserView {
  const { id, email, displayName, role, isActive, createdAt, updatedAt } = user;
  return { id, email, displayName, role, isActive, createdAt, updatedAt };
}

interface ParsedFilters {
  role?: 'ADMIN' | 'MEMBER' | undefined;
  isActive?: boolean | undefined;
  search?: string | undefined;
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

  return paginate(sortNewestFirst(matching).map(toAdminUserView), query);
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

  return sortNewestFirst(matching).map(toAdminUserView);
}

function getUserRecordOrThrow(id: string): UserRecord {
  const user = getDatabase().users.find((candidate) => candidate.id === id);
  if (!user) {
    throw new NotFoundError('User not found');
  }
  return user;
}

export function getUser(actor: Actor, id: string): AdminUserView {
  requireAdmin(actor);
  return toAdminUserView(getUserRecordOrThrow(id));
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

  const updated = mutate(() => {
    if (input.displayName !== undefined) existing.displayName = input.displayName;
    if (input.role !== undefined) existing.role = input.role;
    if (input.isActive !== undefined) existing.isActive = input.isActive;
    existing.updatedAt = nowIso();
    return toAdminUserView(existing);
  });

  recordAuditLog({
    actorId: admin.id,
    action: 'user.updated',
    targetType: 'user',
    targetId: id,
    metadata: input,
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
