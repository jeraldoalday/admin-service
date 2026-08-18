import { z } from 'zod';
import { BadRequestError } from './errors';
import { DEFAULT_PAGE_SIZE } from './pagination';

/**
 * Input schemas carried over verbatim from the HTTP service. Validating in the browser keeps
 * one description of what a valid team name or password is, shared by the forms and by the
 * domain functions they call — the forms cannot drift from the rules the domain enforces.
 */

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(DEFAULT_PAGE_SIZE),
});

export const userRoleEnum = z.enum(['ADMIN', 'MEMBER']);
export const teamRoleEnum = z.enum(['OWNER', 'ADMIN', 'MEMBER']);
export const inviteStatusEnum = z.enum(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED']);
export const apiKeyStatusEnum = z.enum(['ACTIVE', 'REVOKED']);
export const teamPermissionEnum = z.enum([
  'MANAGE_TEAM',
  'MANAGE_MEMBERS',
  'MANAGE_INVITES',
  'MANAGE_PERMISSIONS',
  'MANAGE_API_KEYS',
]);

// -- auth ------------------------------------------------------------------

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().trim().min(1).max(120),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof loginSchema>;

// -- users -----------------------------------------------------------------

export const listUsersQuerySchema = paginationSchema.extend({
  role: userRoleEnum.optional(),
  isActive: z.boolean().optional(),
  search: z.string().trim().min(1).max(200).optional(),
});
export type ListUsersQuery = z.input<typeof listUsersQuerySchema>;

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

// -- teams -----------------------------------------------------------------

export const createTeamSchema = z.object({
  name: z.string().trim().min(1, 'Team name is required').max(120),
});
export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const updateTeamSchema = createTeamSchema;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;

export const updateMemberRoleSchema = z.object({ role: teamRoleEnum });

export const createInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  // Invites cannot hand out ownership; a team gets its owner by creation or promotion.
  role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
});
export type CreateInviteInput = z.input<typeof createInviteSchema>;

export const listInvitesQuerySchema = paginationSchema.extend({
  status: inviteStatusEnum.optional(),
});
export type ListInvitesQuery = z.input<typeof listInvitesQuerySchema>;

// -- permissions -----------------------------------------------------------

export const setMemberPermissionsSchema = z.object({
  permissions: z.array(teamPermissionEnum).max(5),
});
export type SetMemberPermissionsInput = z.infer<typeof setMemberPermissionsSchema>;

// -- api keys --------------------------------------------------------------

export const createApiKeySchema = z.object({
  name: z.string().trim().min(1, 'Key name is required').max(120),
  permissions: z.array(teamPermissionEnum).max(5).default([]),
  expiresAt: z
    .string()
    .trim()
    .min(1)
    .refine((value) => !Number.isNaN(Date.parse(value)), 'expiresAt must be a valid date')
    .refine((value) => Date.parse(value) > Date.now(), 'expiresAt must be in the future')
    .optional(),
});
export type CreateApiKeyInput = z.input<typeof createApiKeySchema>;

export const listApiKeysQuerySchema = paginationSchema.extend({
  status: apiKeyStatusEnum.optional(),
});
export type ListApiKeysQuery = z.input<typeof listApiKeysQuerySchema>;

// -- audit logs ------------------------------------------------------------

export const listAuditLogsQuerySchema = paginationSchema.extend({
  action: z.string().trim().min(1).max(100).optional(),
  targetType: z.string().trim().min(1).max(100).optional(),
});
export type ListAuditLogsQuery = z.input<typeof listAuditLogsQuerySchema>;

/**
 * Parses input and rethrows a validation failure as the same `BadRequestError` the API used
 * to return, so callers handle one error type regardless of where the rejection came from.
 */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path.join('.');
    const message = issue ? `${path ? `${path}: ` : ''}${issue.message}` : 'Invalid input';
    throw new BadRequestError(message, result.error.flatten());
  }
  return result.data;
}
