import { z } from 'zod';
import { paginationSchema } from '../../common/pagination.js';

export const listAuditLogsQuerySchema = paginationSchema.extend({
  action: z.string().trim().min(1).max(100).optional(),
  targetType: z.string().trim().min(1).max(100).optional(),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
