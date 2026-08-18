import { authenticateApiKey, requireApiKeyScope } from './apiKeys';
import type { PaginatedResult } from './pagination';
import { readTeamMembers } from './teams';
import type { TeamMemberView } from './types';

/**
 * The machine-facing surface, formerly mounted under `/service/*`. It exists so the console
 * can demonstrate that an issued key actually works — paste a secret into the API keys
 * screen and this is the call that either returns the team roster or explains the rejection.
 */
export function serviceListTeamMembers(
  secret: string,
  teamId: string,
  query: { page?: number; pageSize?: number } = {},
): PaginatedResult<TeamMemberView> {
  const principal = authenticateApiKey(secret, teamId);
  requireApiKeyScope(principal, 'MANAGE_MEMBERS');
  return readTeamMembers(teamId, query);
}
