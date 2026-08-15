import { z } from 'zod';
import { teamMemberParamsSchema } from '../teams/team.validation.js';

export const teamPermissionEnum = z.enum([
  'MANAGE_TEAM',
  'MANAGE_MEMBERS',
  'MANAGE_INVITES',
  'MANAGE_PERMISSIONS',
  'MANAGE_API_KEYS',
]);

export const memberPermissionsParamsSchema = teamMemberParamsSchema;

export const setMemberPermissionsSchema = z.object({
  permissions: z.array(teamPermissionEnum).max(5),
});

export type SetMemberPermissionsInput = z.infer<typeof setMemberPermissionsSchema>;
