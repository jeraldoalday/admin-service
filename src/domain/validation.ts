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
export const apiKeyStatusEnum = z.enum(['ACTIVE', 'REVOKED', 'EXPIRED']);
export const sessionStatusEnum = z.enum(['ACTIVE', 'REVOKED', 'EXPIRED']);
export const signInOutcomeEnum = z.enum(['SUCCEEDED', 'FAILED', 'BLOCKED']);
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

/**
 * Self-service profile and password changes. These are the only writes an account can make
 * to itself, and they are deliberately separate from the admin-facing `updateUserSchema`:
 * that one can change a role and an active flag, which is exactly what somebody editing
 * their own account must not be able to do.
 */
export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1, 'Display name is required').max(120),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Your current password is required'),
    newPassword: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'The new passwords do not match',
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    path: ['newPassword'],
    message: 'The new password must be different from the current one',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// -- users -----------------------------------------------------------------

const userFilterFields = {
  role: userRoleEnum.optional(),
  isActive: z.boolean().optional(),
  // Locked is a state an account is in rather than a flag it carries, so it filters like one
  // — the question "who cannot currently sign in?" is asked of the list, not of the row.
  isLocked: z.boolean().optional(),
  search: z.string().trim().min(1).max(200).optional(),
};

export const userSortEnum = z.enum(['createdAt', 'displayName', 'email', 'role']);
export type UserSortField = z.infer<typeof userSortEnum>;

export const sortDirectionEnum = z.enum(['asc', 'desc']);
export type SortDirection = z.infer<typeof sortDirectionEnum>;

/**
 * Ordering travels with the filters rather than with the pagination, because an export has
 * to honour it too: a file whose rows arrive in a different order from the screen that asked
 * for it is a file somebody has to re-sort by hand. Newest-first stays the default, which is
 * what the list did before ordering was a choice at all.
 */
const userSortFields = {
  sort: userSortEnum.default('createdAt'),
  direction: sortDirectionEnum.default('desc'),
};

/** The filter set on its own, for reads that want every match rather than a page of them. */
export const userFiltersSchema = z.object({ ...userFilterFields, ...userSortFields });
export type UserFilters = z.input<typeof userFiltersSchema>;

export const listUsersQuerySchema = paginationSchema.extend({
  ...userFilterFields,
  ...userSortFields,
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

/**
 * A batch of accounts and the one thing to do to all of them.
 *
 * The cap is a guard against a mis-click rather than a performance limit: the whole point of
 * the screen is that a filter can select every account on the platform, and "delete" applied
 * to an accidental selection of a thousand is not something a confirmation dialog alone
 * should be trusted to catch. A hundred is comfortably more than any deliberate batch and
 * far less than a whole platform.
 */
export const bulkUserActionEnum = z.enum(['activate', 'deactivate', 'unlock', 'delete']);

export const bulkUserActionSchema = z.object({
  action: bulkUserActionEnum,
  userIds: z
    .array(z.string().trim().min(1))
    .min(1, 'Select at least one account')
    .max(100, 'Select no more than 100 accounts at a time'),
});
export type BulkUserActionInput = z.input<typeof bulkUserActionSchema>;

/**
 * One row of an imported file, once its cells have been named.
 *
 * There is deliberately no password column. A CSV of plaintext passwords is a file nobody
 * should be asked to produce and nobody can safely delete afterwards — it gets mailed
 * around, it sits in a downloads folder, and every account in it is compromised the moment
 * it does. Imported accounts are given a generated password instead, handed back once.
 */
export const importUserRowSchema = z.object({
  email: z.string().trim().toLowerCase().email('is not a valid email address'),
  displayName: z.string().trim().min(1, 'is required').max(120),
  role: userRoleEnum.default('MEMBER'),
});
export type ImportUserRowInput = z.input<typeof importUserRowSchema>;

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

// -- sessions and sign-in history ------------------------------------------

/**
 * What a session calls itself. The browser supplies it, so it is untrusted text that will be
 * rendered next to a Revoke button: it is trimmed, capped, and stripped of the control
 * characters that would otherwise let a label rearrange the line it sits on. An empty or
 * missing one becomes a neutral placeholder rather than a blank row, because a session with
 * no name at all is still a session somebody may need to end.
 */
export const UNKNOWN_SESSION_LABEL = 'Unknown device';

export const sessionLabelSchema = z
  .string()
  .catch(UNKNOWN_SESSION_LABEL)
  .default(UNKNOWN_SESSION_LABEL)
  .transform((value) => {
    // `\p{Cc}` names the control characters rather than spelling them out, which says what
    // is being removed and keeps a literal NUL out of the source.
    const cleaned = value
      .replace(/\p{Cc}+/gu, ' ')
      .trim()
      .slice(0, 200);
    return cleaned === '' ? UNKNOWN_SESSION_LABEL : cleaned;
  });

export const listSessionsQuerySchema = paginationSchema.extend({
  status: sessionStatusEnum.optional(),
});
export type ListSessionsQuery = z.input<typeof listSessionsQuerySchema>;

export const listSignInAttemptsQuerySchema = paginationSchema.extend({
  outcome: signInOutcomeEnum.optional(),
  email: z.string().trim().toLowerCase().min(1).max(200).optional(),
});
export type ListSignInAttemptsQuery = z.input<typeof listSignInAttemptsQuerySchema>;

// -- audit logs ------------------------------------------------------------

const dateBoundary = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'must be a valid date');

/**
 * A calendar date names a whole day, not the instant it begins. Read as-is, a `to` of
 * 2026-08-19 would exclude everything that happened on the nineteenth, which is not what
 * anybody picking a date range means — so a date-only boundary is widened to cover its day.
 * Entries are stored as UTC instants, and the boundaries are read the same way.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function startOfBoundary(value: string): number {
  return Date.parse(DATE_ONLY.test(value) ? `${value}T00:00:00.000Z` : value);
}

export function endOfBoundary(value: string): number {
  return Date.parse(DATE_ONLY.test(value) ? `${value}T23:59:59.999Z` : value);
}

const auditFilterFields = {
  action: z.string().trim().min(1).max(100).optional(),
  targetType: z.string().trim().min(1).max(100).optional(),
  actorId: z.string().trim().min(1).max(100).optional(),
  teamId: z.string().trim().min(1).max(100).optional(),
  search: z.string().trim().min(1).max(200).optional(),
  from: dateBoundary.optional(),
  to: dateBoundary.optional(),
};

function rangeIsOrdered(query: { from?: string | undefined; to?: string | undefined }): boolean {
  if (!query.from || !query.to) return true;
  return startOfBoundary(query.from) <= endOfBoundary(query.to);
}

const RANGE_MESSAGE = {
  path: ['from'],
  message: 'The start of the range must not be after its end',
};

/** The filter set on its own, for reads that want every match rather than a page of them. */
export const auditFiltersSchema = z.object(auditFilterFields).refine(rangeIsOrdered, RANGE_MESSAGE);
export type AuditLogFilters = z.input<typeof auditFiltersSchema>;

export const listAuditLogsQuerySchema = paginationSchema
  .extend(auditFilterFields)
  .refine(rangeIsOrdered, RANGE_MESSAGE);
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
