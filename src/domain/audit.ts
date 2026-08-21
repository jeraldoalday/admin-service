import { getDatabase, mutate } from './database';
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

  const search = filters.search?.toLowerCase();
  if (search && !searchableText(log).includes(search)) return false;

  const at = Date.parse(log.createdAt);
  if (filters.from && at < startOfBoundary(filters.from)) return false;
  if (filters.to && at > endOfBoundary(filters.to)) return false;
  return true;
}

export function listAuditLogs(rawQuery: ListAuditLogsQuery = {}): PaginatedResult<AuditLogView> {
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
export function listAllAuditLogs(rawFilters: AuditLogFilters = {}): AuditLogView[] {
  const filters = parseInput(auditFiltersSchema, rawFilters);
  return sortNewestFirst(getDatabase().auditLogs.filter((log) => matchesFilters(log, filters)));
}

/** Distinct action names present in the log, for populating the filter dropdown. */
export function listAuditActions(): string[] {
  return [...new Set(getDatabase().auditLogs.map((log) => log.action))].sort();
}

export function listAuditTargetTypes(): string[] {
  return [...new Set(getDatabase().auditLogs.map((log) => log.targetType))].sort();
}

export interface AuditActorOption {
  id: string;
  /** The account's name and email, or the bare id once the account itself is gone. */
  label: string;
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
export function listAuditActors(): AuditActorOption[] {
  const db = getDatabase();
  const ids = [...new Set(db.auditLogs.flatMap((log) => (log.actorId ? [log.actorId] : [])))];

  return ids
    .map((id) => {
      const user = db.users.find((candidate) => candidate.id === id);
      return { id, label: user ? `${user.displayName} (${user.email})` : id };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
