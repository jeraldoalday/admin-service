import type { Request, Response } from 'express';
import { listAuditLogs } from './audit.service.js';
import { listAuditLogsQuerySchema } from './audit.validation.js';

export async function list(req: Request, res: Response): Promise<void> {
  const query = listAuditLogsQuerySchema.parse(req.query);
  const result = await listAuditLogs(query);
  res.status(200).json(result);
}
