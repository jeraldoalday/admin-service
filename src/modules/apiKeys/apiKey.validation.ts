import { z } from 'zod';
import { paginationSchema } from '../../common/pagination.js';
import { teamIdParamsSchema } from '../teams/team.validation.js';
import { teamPermissionEnum } from '../permissions/permission.validation.js';

export const apiKeyStatusEnum = z.enum(['ACTIVE', 'REVOKED']);

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(120),
  permissions: z.array(teamPermissionEnum).max(5).default([]),
  expiresAt: z.coerce
    .date()
    .refine((date) => date.getTime() > Date.now(), 'expiresAt must be in the future')
    .optional(),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

export const apiKeyIdParamsSchema = teamIdParamsSchema.extend({
  keyId: z.string().min(1),
});

export const listApiKeysQuerySchema = paginationSchema.extend({
  status: apiKeyStatusEnum.optional(),
});

export type ListApiKeysQuery = z.infer<typeof listApiKeysQuerySchema>;
