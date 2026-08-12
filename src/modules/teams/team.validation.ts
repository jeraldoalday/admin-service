import { z } from 'zod';
import { paginationSchema } from '../../common/pagination.js';

export const teamRoleEnum = z.enum(['OWNER', 'ADMIN', 'MEMBER']);
export const inviteStatusEnum = z.enum(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED']);

export const createTeamSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;

export const listTeamsQuerySchema = paginationSchema;

export type ListTeamsQuery = z.infer<typeof listTeamsQuerySchema>;

export const updateTeamSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;

export const teamIdParamsSchema = z.object({
  teamId: z.string().min(1),
});

export const teamMemberParamsSchema = teamIdParamsSchema.extend({
  userId: z.string().min(1),
});

export const listMembersQuerySchema = paginationSchema;

export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;

export const updateMemberRoleSchema = z.object({
  role: teamRoleEnum,
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

export const createInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: teamRoleEnum.exclude(['OWNER']).default('MEMBER'),
});

export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export const listInvitesQuerySchema = paginationSchema.extend({
  status: inviteStatusEnum.optional(),
});

export type ListInvitesQuery = z.infer<typeof listInvitesQuerySchema>;

export const teamInviteParamsSchema = teamIdParamsSchema.extend({
  inviteId: z.string().min(1),
});

export const acceptInviteParamsSchema = z.object({
  token: z.string().min(1),
});
