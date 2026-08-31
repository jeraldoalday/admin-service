import type {
  ApiKeyRecord,
  AuditLogRecord,
  RecoveryCodeRecord,
  SignInAttemptRecord,
  SignInChallengeRecord,
  TeamInviteRecord,
  TeamMembershipRecord,
  TeamPermissionGrantRecord,
  TeamRecord,
  TwoFactorRecord,
  UserRecord,
  UserSessionRecord,
} from './types';

/**
 * The whole persisted state of the console. This replaces the SQLite database the service
 * used to talk to: the same tables, held in memory and mirrored into `localStorage` so a
 * reload does not wipe your work. Tests run it with persistence switched off.
 */
export interface Database {
  version: number;
  users: UserRecord[];
  teams: TeamRecord[];
  memberships: TeamMembershipRecord[];
  invites: TeamInviteRecord[];
  permissionGrants: TeamPermissionGrantRecord[];
  apiKeys: ApiKeyRecord[];
  sessions: UserSessionRecord[];
  signInAttempts: SignInAttemptRecord[];
  twoFactor: TwoFactorRecord[];
  recoveryCodes: RecoveryCodeRecord[];
  signInChallenges: SignInChallengeRecord[];
  auditLogs: AuditLogRecord[];
}

/**
 * Bumped to 2 when audit entries gained the team they belong to, and to 3 when sign-in grew
 * a memory: the sessions a sign-in opens and the attempts it leaves behind. Stored databases
 * are discarded rather than migrated on a version change, which for a demo console holding
 * seeded data is the honest trade: a half-migrated audit trail would be worse than a fresh
 * one, and a half-migrated session table would sign people in on evidence it cannot vouch
 * for.
 *
 * And to 4 when sign-in grew a second factor. A stored database from before it has no
 * authenticators to migrate, but it also has no table to put one in, and adding the table on
 * read would mean a half-described database walking around claiming to be whole.
 */
export const SCHEMA_VERSION = 4;
export const STORAGE_KEY = 'admin-service:db';

export function emptyDatabase(): Database {
  return {
    version: SCHEMA_VERSION,
    users: [],
    teams: [],
    memberships: [],
    invites: [],
    permissionGrants: [],
    apiKeys: [],
    sessions: [],
    signInAttempts: [],
    twoFactor: [],
    recoveryCodes: [],
    signInChallenges: [],
    auditLogs: [],
  };
}

let state: Database = emptyDatabase();
let storage: Storage | null = null;
let revision = 0;
const listeners = new Set<() => void>();

export function getDatabase(): Database {
  return state;
}

/**
 * Monotonic counter used as the `useSyncExternalStore` snapshot. Every committed mutation
 * bumps it, which is cheaper and more reliable than diffing the tables.
 */
export function getRevision(): number {
  return revision;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function persist(): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A full or unavailable quota should never take the console down; the session simply
    // stops surviving reloads.
  }
}

/**
 * Runs a mutation against the tables, then persists and notifies subscribers exactly once.
 * Reads should go straight through `getDatabase()`.
 */
export function mutate<T>(fn: (db: Database) => T): T {
  const result = fn(state);
  revision += 1;
  persist();
  listeners.forEach((listener) => listener());
  return result;
}

/** Replaces the tables wholesale — used by seeding and by "reset demo data". */
export function replaceDatabase(next: Database): void {
  state = next;
  revision += 1;
  persist();
  listeners.forEach((listener) => listener());
}

function isDatabase(value: unknown): value is Database {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<Database>;
  return (
    candidate.version === SCHEMA_VERSION &&
    Array.isArray(candidate.users) &&
    Array.isArray(candidate.teams) &&
    Array.isArray(candidate.memberships) &&
    Array.isArray(candidate.invites) &&
    Array.isArray(candidate.permissionGrants) &&
    Array.isArray(candidate.apiKeys) &&
    Array.isArray(candidate.sessions) &&
    Array.isArray(candidate.signInAttempts) &&
    Array.isArray(candidate.twoFactor) &&
    Array.isArray(candidate.recoveryCodes) &&
    Array.isArray(candidate.signInChallenges) &&
    Array.isArray(candidate.auditLogs)
  );
}

/**
 * Points the store at a storage backend and loads whatever is already there. Returns false
 * when nothing usable was found, so the caller can decide to seed demo data. Records written
 * by an older schema version are discarded rather than migrated.
 */
export function attachStorage(target: Storage | null): boolean {
  storage = target;
  if (!storage) return false;

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return false;

    const parsed: unknown = JSON.parse(raw);
    if (!isDatabase(parsed)) return false;

    state = parsed;
    revision += 1;
    return true;
  } catch {
    return false;
  }
}

export function clearStoredDatabase(): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do — the in-memory reset below is what actually matters.
  }
}
