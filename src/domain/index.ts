/**
 * The console's domain layer: everything the UI is allowed to know about users, teams,
 * invites, permissions, API keys, and the audit trail. It is deliberately free of React so
 * the rules can be tested — and reasoned about — on their own.
 */
export * from './types';
export type {
  CreateApiKeyInput,
  CreateInviteInput,
  CreateTeamInput,
  ListApiKeysQuery,
  ListAuditLogsQuery,
  ListInvitesQuery,
  ListUsersQuery,
  LoginInput,
  RegisterInput,
  SetMemberPermissionsInput,
  UpdateTeamInput,
  UpdateUserInput,
} from './validation';
export * from './errors';
export * from './pagination';
export {
  type Actor,
  findMembership,
  hasTeamPermission,
  requireAdmin,
  requireTeamMembership,
  requireTeamPermission,
} from './guards';
export {
  attachStorage,
  clearStoredDatabase,
  getDatabase,
  getRevision,
  replaceDatabase,
  subscribe,
  emptyDatabase,
  STORAGE_KEY,
} from './database';
export { DEMO_ADMIN_EMAIL, DEMO_PASSWORD, buildSeedDatabase, seedDatabase } from './seed';
export * as auth from './auth';
export * as users from './users';
export * as teams from './teams';
export * as permissions from './permissions';
export * as apiKeys from './apiKeys';
export * as audit from './audit';
export * as service from './service';
