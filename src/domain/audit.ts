import { getDatabase, mutate } from './database';
import { createId, nowIso } from './ids';
import { paginate, sortNewestFirst, type PaginatedResult } from './pagination';
import type { AuditLogView } from './types';
import { listAuditLogsQuerySchema, parseInput, type ListAuditLogsQuery } from './validation';

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

export function listAuditLogs(rawQuery: ListAuditLogsQuery = {}): PaginatedResult<AuditLogView> {
  const query = parseInput(listAuditLogsQuerySchema, rawQuery);
  const matching = getDatabase().auditLogs.filter(
    (log) =>
      (!query.action || log.action === query.action) &&
      (!query.targetType || log.targetType === query.targetType),
  );
  return paginate(sortNewestFirst(matching), query);
}

/** Distinct action names present in the log, for populating the filter dropdown. */
export function listAuditActions(): string[] {
  return [...new Set(getDatabase().auditLogs.map((log) => log.action))].sort();
}

export function listAuditTargetTypes(): string[] {
  return [...new Set(getDatabase().auditLogs.map((log) => log.targetType))].sort();
}
