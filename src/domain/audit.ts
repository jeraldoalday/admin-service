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
      metadata: input.metadata ?? null,
      createdAt: nowIso(),
    });
  });
}

interface ParsedFilters {
  action?: string | undefined;
  targetType?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

function matchesFilters(log: AuditLogRecord, filters: ParsedFilters): boolean {
  if (filters.action && log.action !== filters.action) return false;
  if (filters.targetType && log.targetType !== filters.targetType) return false;

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
