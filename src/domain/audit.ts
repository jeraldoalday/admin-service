import { getDatabase, mutate } from './database';
import { requireAdmin, requireTeamPermission, type Actor } from './guards';
import { createId, nowIso } from './ids';
import { paginate, sortNewestFirst, type PaginatedResult } from './pagination';
import type { AuditLogRecord, AuditLogView } from './types';
import {
  auditFiltersSchema,
  endOfBoundary,
  listAuditLogsQuerySchema,
  parseInput,
  startOfBoundary,
  type AuditLogFilters,
  type ListAuditLogsQuery,
} from './validation';

export interface RecordAuditLogInput {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  /** The team the action happened inside, when it happened inside one. */
  teamId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Appends an audit entry. Every mutating action in the console funnels through here, which
 * is what makes the audit log a complete record rather than a sample.
 */
export function recordAuditLog(input: RecordAuditLogInput): void {
  mutate((db) => {
    db.auditLogs.push({
      id: createId(),
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      teamId: input.teamId ?? null,
      metadata: input.metadata ?? null,
      createdAt: nowIso(),
    });
  });
}

interface ParsedFilters {
  action?: string | undefined;
  targetType?: string | undefined;
  actorId?: string | undefined;
  teamId?: string | undefined;
  search?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

/**
 * The text a free-text search runs against: everything the row carries that a reader could
 * plausibly be looking for, including the metadata, which is where the interesting detail of
 * an entry usually lives — the email an invite was addressed to, the name a team was renamed
 * to, the scopes a key was minted with. Searching the rendered JSON rather than walking the
 * object keeps the search matching what the screen actually shows in the details column.
 */
function searchableText(log: AuditLogRecord): string {
  return [
    log.action,
    log.targetType,
    log.targetId ?? '',
    log.metadata ? JSON.stringify(log.metadata) : '',
  ]
    .join(' ')
    .toLowerCase();
}

function matchesFilters(log: AuditLogRecord, filters: ParsedFilters): boolean {
  if (filters.action && log.action !== filters.action) return false;
  if (filters.targetType && log.targetType !== filters.targetType) return false;
  if (filters.actorId && log.actorId !== filters.actorId) return false;
  if (filters.teamId && log.teamId !== filters.teamId) return false;

  const search = filters.search?.toLowerCase();
  if (search && !searchableText(log).includes(search)) return false;

  const at = Date.parse(log.createdAt);
  if (filters.from && at < startOfBoundary(filters.from)) return false;
  if (filters.to && at > endOfBoundary(filters.to)) return false;
  return true;
}

export function listAuditLogs(
  actor: Actor,
  rawQuery: ListAuditLogsQuery = {},
): PaginatedResult<AuditLogView> {
  requireAdmin(actor);
  const query = parseInput(listAuditLogsQuerySchema, rawQuery);
  const matching = getDatabase().auditLogs.filter((log) => matchesFilters(log, query));
  return paginate(sortNewestFirst(matching), query);
}

/**
 * Every entry the filters match, in one array rather than a page of them.
 *
 * An export has to be built on this rather than on `listAuditLogs`: a page is capped at a
 * hundred rows by the pagination schema, so an export that asked for one page stopped at a
 * hundred entries while telling the reader it covered everything the filters matched.
 */
export function listAllAuditLogs(actor: Actor, rawFilters: AuditLogFilters = {}): AuditLogView[] {
  requireAdmin(actor);
  const filters = parseInput(auditFiltersSchema, rawFilters);
  return sortNewestFirst(getDatabase().auditLogs.filter((log) => matchesFilters(log, filters)));
}

/** Distinct action names present in the log, for populating the filter dropdown. */
export function listAuditActions(actor: Actor): string[] {
  requireAdmin(actor);
  return [...new Set(getDatabase().auditLogs.map((log) => log.action))].sort();
}

export function listAuditTargetTypes(actor: Actor): string[] {
  requireAdmin(actor);
  return [...new Set(getDatabase().auditLogs.map((log) => log.targetType))].sort();
}

/**
 * One team's slice of the log, for the people who run that team.
 *
 * The platform audit screen stays admin-only, and rightly so — it spans every account and
 * every team. But a team owner asking who revoked their deploy key should not have to ask a
 * platform admin, and the entries that answer that question are already scoped to their team.
 * MANAGE_TEAM is the gate, which is the same permission that already covers renaming the
 * team and is grantable to a member who runs one without being its owner.
 *
 * The team filter is applied after the caller's filters rather than merged with them, so a
 * caller passing a different team id narrows their own team's slice to nothing instead of
 * reading somebody else's.
 */
export function listTeamActivity(
  actor: Actor,
  teamId: string,
  rawQuery: ListAuditLogsQuery = {},
): PaginatedResult<AuditLogView> {
  requireTeamPermission(actor, teamId, 'MANAGE_TEAM');
  const query = parseInput(listAuditLogsQuerySchema, rawQuery);
  const matching = getDatabase().auditLogs.filter(
    (log) => log.teamId === teamId && matchesFilters(log, query),
  );
  return paginate(sortNewestFirst(matching), query);
}

/** Every entry in one team's slice that the filters match, for an export. */
export function listAllTeamActivity(
  actor: Actor,
  teamId: string,
  rawFilters: AuditLogFilters = {},
): AuditLogView[] {
  requireTeamPermission(actor, teamId, 'MANAGE_TEAM');
  const filters = parseInput(auditFiltersSchema, rawFilters);
  return sortNewestFirst(
    getDatabase().auditLogs.filter((log) => log.teamId === teamId && matchesFilters(log, filters)),
  );
}

/** Distinct action names present in one team's slice of the log. */
export function listTeamActivityActions(actor: Actor, teamId: string): string[] {
  requireTeamPermission(actor, teamId, 'MANAGE_TEAM');
  return [
    ...new Set(
      getDatabase()
        .auditLogs.filter((log) => log.teamId === teamId)
        .map((log) => log.action),
    ),
  ].sort();
}

/** Distinct target types present in one team's slice of the log. */
export function listTeamActivityTargetTypes(actor: Actor, teamId: string): string[] {
  requireTeamPermission(actor, teamId, 'MANAGE_TEAM');
  return [
    ...new Set(
      getDatabase()
        .auditLogs.filter((log) => log.teamId === teamId)
        .map((log) => log.targetType),
    ),
  ].sort();
}

export interface AuditTeamOption {
  id: string;
  /** The team's current name, or its bare id once the team itself is gone. */
  label: string;
}

/**
 * The teams that appear in the log, for populating the team filter.
 *
 * A deleted team keeps its id as the label rather than dropping out of the list: its entries
 * are exactly the ones somebody asking what happened to it is looking for, and the last of
 * them is the deletion itself.
 */
export function listAuditTeams(actor: Actor): AuditTeamOption[] {
  requireAdmin(actor);
  const db = getDatabase();
  const ids = [...new Set(db.auditLogs.flatMap((log) => (log.teamId ? [log.teamId] : [])))];

  return ids
    .map((id) => {
      const team = db.teams.find((candidate) => candidate.id === id);
      return { id, label: team ? team.name : id };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

export interface AuditActorOption {
  id: string;
  /** The account's name and email, or the bare id once the account itself is gone. */
  label: string;
}

function toActorOptions(ids: string[]): AuditActorOption[] {
  const users = getDatabase().users;
  return ids
    .map((id) => {
      const user = users.find((candidate) => candidate.id === id);
      return { id, label: user ? `${user.displayName} (${user.email})` : id };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * The accounts that appear in the log, for populating the actor filter.
 *
 * The label is resolved against the users table on read rather than stored on the entry: an
 * audit row is append-only and must not be rewritten when somebody changes their display
 * name, but a filter listing ids nobody recognises is not a filter anyone can use. An actor
 * whose account has since been deleted keeps its id as the label, since the entries it wrote
 * are still there and still worth reaching.
 */
export function listAuditActors(actor: Actor): AuditActorOption[] {
  requireAdmin(actor);
  return toActorOptions([
    ...new Set(getDatabase().auditLogs.flatMap((log) => (log.actorId ? [log.actorId] : []))),
  ]);
}

/**
 * The accounts that appear in one team's slice of the log. Deliberately not the platform-wide
 * list: a team owner may see who acted on their team, which is a much smaller set than every
 * account that has ever done anything.
 */
export function listTeamActivityActors(actor: Actor, teamId: string): AuditActorOption[] {
  requireTeamPermission(actor, teamId, 'MANAGE_TEAM');
  return toActorOptions([
    ...new Set(
      getDatabase().auditLogs.flatMap((log) =>
        log.teamId === teamId && log.actorId ? [log.actorId] : [],
      ),
    ),
  ]);
}
