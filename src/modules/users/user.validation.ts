import { z } from 'zod';
import { paginationSchema } from '../../common/pagination.js';

export const userRoleEnum = z.enum(['ADMIN', 'MEMBER']);

export const listUsersQuerySchema = paginationSchema.extend({
  role: userRoleEnum.optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const userIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const updateUserSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    role: userRoleEnum.optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
