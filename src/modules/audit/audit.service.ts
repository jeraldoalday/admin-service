import { prisma } from '../../db/prisma.js';
import {
  buildPaginatedResult,
  paginationToSkipTake,
  type PaginatedResult,
} from '../../common/pagination.js';
import type { ListAuditLogsQuery } from './audit.validation.js';

export interface RecordAuditLogInput {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuditLogView {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: unknown;
  createdAt: Date;
}

export async function recordAuditLog(input: RecordAuditLogInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}

export async function listAuditLogs(
  query: ListAuditLogsQuery,
): Promise<PaginatedResult<AuditLogView>> {
  const where = {
    ...(query.action ? { action: query.action } : {}),
    ...(query.targetType ? { targetType: query.targetType } : {}),
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...paginationToSkipTake(query),
    }),
    prisma.auditLog.count({ where }),
  ]);

  const items: AuditLogView[] = logs.map((log) => ({
    ...log,
    metadata: log.metadata ? (JSON.parse(log.metadata) as unknown) : null,
  }));

  return buildPaginatedResult(items, total, query);
}
