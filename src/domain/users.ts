import { recordAuditLog } from './audit';
import { getDatabase, mutate } from './database';
import { BadRequestError, NotFoundError, toErrorMessage } from './errors';
import { requireAdmin, type Actor } from './guards';
import { nowIso } from './ids';
import { lockStateFor, unlockAccount } from './lockout';
import { paginate, sortNewestFirst, type PaginatedResult } from './pagination';
import { deleteSessionsForUser, revokeSessionsForUser } from './sessions';
import { reassignTeamsOwnedSolelyBy } from './teams';
import { deleteTwoFactorForUser } from './twoFactor';
import type {
  AdminUserView,
  BulkUserAction,
  BulkUserActionResult,
  BulkUserOutcome,
  UserRecord,
} from './types';
import {
  bulkUserActionSchema,
  listUsersQuerySchema,
  parseInput,
  updateUserSchema,
  userFiltersSchema,
  type BulkUserActionInput,
  type ListUsersQuery,
  type SortDirection,
  type UpdateUserInput,
  type UserFilters,
  type UserSortField,
} from './validation';

function toAdminUserView(user: UserRecord): AdminUserView {
  const { id, email, displayName, role, isActive, createdAt, updatedAt } = user;
  const lock = lockStateFor(email);

  return {
    id,
    email,
    displayName,
    role,
    isActive,
    isLocked: lock.isLocked,
    lockedUntil: lock.lockedUntil,
    createdAt,
    updatedAt,
  };
}

interface ParsedFilters {
  role?: 'ADMIN' | 'MEMBER' | undefined;
  isActive?: boolean | undefined;
  isLocked?: boolean | undefined;
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
  if (filters.isLocked !== undefined && lockStateFor(user.email).isLocked !== filters.isLocked) {
    return false;
  }

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

  // Deactivating an account has to reach the sessions it already has open. A screen reading
  // through the session provider notices on its next render, but the record is what outlives
  // the render, and an account nobody may sign in to should not be one anybody is still
  // signed in as.
  const revokedSessions = input.isActive === false ? revokeSessionsForUser(admin.id, id) : 0;

  recordAuditLog({
    actorId: admin.id,
    action: 'user.updated',
    targetType: 'user',
    targetId: id,
    metadata: { ...input, ...(revokedSessions > 0 ? { revokedSessions } : {}) },
  });

  return updated;
}

/**
 * Deletes a user along with the rows the SQLite schema used to cascade away for us — the
 * team memberships and permission grants keyed to them. Invites are addressed to an email
 * rather than a user id and are deliberately left alone, exactly as before.
 *
 * Any team the account was the only owner of is handed to the member left longest behind
 * first, so the deletion cannot strand a team with nobody able to administer it, and the
 * account's sessions go with it.
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

  // The sessions go with the account rather than being marked revoked: there is no longer an
  // account for them to be sessions of, and a revoked session pointing at a user id nobody
  // holds is a row that can only ever confuse whoever reads it next. The sign-in attempts
  // stay — they are addressed to an email, and a run of failures against an address is worth
  // keeping precisely when the account behind it has just been removed.
  deleteSessionsForUser(id);

  // The authenticator and its recovery codes go the same way and for the same reason: they
  // are rows keyed to a user id nobody holds any more, and a live recovery code belonging to
  // no account is the one kind of leftover that could still be used for something.
  deleteTwoFactorForUser(id);

  recordAuditLog({
    actorId: admin.id,
    action: 'user.deleted',
    targetType: 'user',
    targetId: id,
    ...(reassignments.length > 0 ? { metadata: { reassignedTeams: reassignments } } : {}),
  });
}

/**
 * Applies one action to a batch of accounts, and reports what became of each of them.
 *
 * Every account goes through the same single-account function the row's own button calls —
 * `updateUser`, `unlockAccount`, `deleteUser` — rather than through a batch-shaped write of
 * its own. That is the whole design: the self-protection rules, the session revocation that
 * rides along with a deactivation, the handover of a team whose only owner is being deleted,
 * and the per-account audit entries all keep working because none of them has been
 * reimplemented here. A second code path for the same four actions would be a second place
 * for those rules to be forgotten.
 *
 * One account failing does not stop the rest. A batch is a list of independent requests that
 * happen to have been asked for together — refusing all forty because the thirty-first was
 * the admin's own account would be a worse answer than doing thirty-nine and saying which
 * one was refused. The report is what makes that honest: it names the ones that were
 * refused, and why, in the caller's own words from the domain error.
 */
export function bulkUpdateUsers(actor: Actor, rawInput: BulkUserActionInput): BulkUserActionResult {
  const admin = requireAdmin(actor);
  const input = parseInput(bulkUserActionSchema, rawInput);

  // The same account named twice is one account, not two attempts at it — a second pass
  // would report a delete as having failed with "User not found" against a row this very
  // call had just removed.
  const userIds = [...new Set(input.userIds)];

  const outcomes = userIds.map((userId) => applyBulkAction(admin, input.action, userId));

  const result: BulkUserActionResult = {
    action: input.action,
    requested: userIds.length,
    changed: outcomes.filter((outcome) => outcome.status === 'CHANGED'),
    unchanged: outcomes.filter((outcome) => outcome.status === 'UNCHANGED'),
    failed: outcomes.filter((outcome) => outcome.status === 'FAILED'),
  };

  // A summary entry on top of the per-account ones the actions themselves wrote. Without it
  // the log shows thirty deactivations a second apart and nothing saying they were one
  // decision; with it, a reader can tell a batch from a bad afternoon. It is recorded even
  // when every account was refused, since an administrator reaching for a bulk delete is
  // worth a line in the log whether or not it landed.
  recordAuditLog({
    actorId: admin.id,
    action: `user.bulk_${input.action}`,
    targetType: 'user',
    targetId: null,
    metadata: {
      requested: result.requested,
      changed: result.changed.length,
      unchanged: result.unchanged.length,
      failed: result.failed.length,
      userIds,
    },
  });

  return result;
}

function applyBulkAction(admin: Actor, action: BulkUserAction, userId: string): BulkUserOutcome {
  const user = getDatabase().users.find((candidate) => candidate.id === userId);

  if (!user) {
    return {
      userId,
      email: userId,
      displayName: userId,
      status: 'FAILED',
      message: 'User not found',
    };
  }

  // Captured before the action runs: a deleted account has no row left to read a name off,
  // and a report that could only identify it by id would be the least readable line in it.
  const identity = { userId, email: user.email, displayName: user.displayName };

  const alreadyThere = describeNoOp(action, user);
  if (alreadyThere) {
    return { ...identity, status: 'UNCHANGED', message: alreadyThere };
  }

  try {
    runBulkAction(admin, action, userId);
    return { ...identity, status: 'CHANGED', message: null };
  } catch (caught) {
    return { ...identity, status: 'FAILED', message: toErrorMessage(caught) };
  }
}

/**
 * Whether the account is already where the action would put it, and how to say so.
 *
 * Checking first rather than writing and shrugging is what keeps the audit log worth
 * reading: `updateUser` and `unlockAccount` both record an entry unconditionally, so a bulk
 * unlock across a filtered page would otherwise stamp "unlocked" against every account that
 * was never locked — thirty entries describing nothing. Deletion has no such state to be in
 * already; an account either exists or was not found.
 */
function describeNoOp(action: BulkUserAction, user: UserRecord): string | null {
  switch (action) {
    case 'activate':
      return user.isActive ? 'Already active' : null;
    case 'deactivate':
      return user.isActive ? null : 'Already deactivated';
    case 'unlock':
      return lockStateFor(user.email).isLocked ? null : 'Not locked out';
    case 'delete':
      return null;
  }
}

function runBulkAction(admin: Actor, action: BulkUserAction, userId: string): void {
  switch (action) {
    case 'activate':
      updateUser(admin, userId, { isActive: true });
      return;
    case 'deactivate':
      updateUser(admin, userId, { isActive: false });
      return;
    case 'unlock':
      unlockAccount(admin, userId);
      return;
    case 'delete':
      deleteUser(admin, userId);
      return;
  }
}
