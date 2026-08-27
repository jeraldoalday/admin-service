import { recordAuditLog } from './audit';
import { getDatabase, mutate } from './database';
import { ForbiddenError, NotFoundError } from './errors';
import { requireActor, type Actor } from './guards';
import { createToken, nowIso } from './ids';
import { paginate, sortNewestFirst, type PaginatedResult } from './pagination';
import type { SessionStatus, UserSessionRecord, UserSessionView } from './types';
import {
  listSessionsQuerySchema,
  parseInput,
  sessionLabelSchema,
  type ListSessionsQuery,
} from './validation';

/**
 * Signed-in sessions.
 *
 * The console used to be signed in by holding a user id in `localStorage`, which meant a
 * session could not be ended from anywhere except the browser holding it: there was nothing
 * on the other side to end. A session record moves that decision into the store. The browser
 * holds an opaque id, and whether it still opens anything is decided here — by an expiry, by
 * a revocation, and by the state of the account behind it — which is what makes "sign out my
 * other devices" and "revoke this stolen session" possible at all.
 *
 * It is the same trade the API used to make with a refresh token, minus the part where a
 * token already issued cannot be taken back.
 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * How stale a session's last-seen stamp is allowed to get before it is written again.
 * Without a floor, every render of every screen would be a store mutation, and the store
 * notifies its subscribers on each one — so the console would spend its time re-rendering
 * because it had just re-rendered.
 */
export const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;

/**
 * The status a session actually has now, rather than the one last written to it. A session
 * past its expiry is already dead, and nothing rewrites the row to say so until the boot
 * sweep gets to it — so, as with an invite or an API key, the truth is derived on read and
 * every screen agrees at once.
 */
export function effectiveSessionStatus(
  session: UserSessionRecord,
  now = Date.now(),
): SessionStatus {
  if (session.revokedAt) return 'REVOKED';
  if (Date.parse(session.expiresAt) <= now) return 'EXPIRED';
  return 'ACTIVE';
}

function toSessionView(session: UserSessionRecord, currentSessionId?: string): UserSessionView {
  const { id, userId, label, expiresAt, lastSeenAt, revokedAt, createdAt } = session;
  return {
    id,
    userId,
    label,
    status: effectiveSessionStatus(session),
    isCurrent: id === currentSessionId,
    expiresAt,
    lastSeenAt,
    revokedAt,
    createdAt,
  };
}

function findSession(sessionId: string): UserSessionRecord | undefined {
  return getDatabase().sessions.find((session) => session.id === sessionId);
}

/**
 * Opens a session for an account that has just proved who it is. The id is a random token
 * rather than a sequential one, since it is the only thing standing between a browser and
 * the account: an id somebody can guess is a session somebody can take.
 */
export function startSession(userId: string, rawLabel?: string): UserSessionRecord {
  const label = parseInput(sessionLabelSchema, rawLabel);

  return mutate((db) => {
    const timestamp = nowIso();
    const session: UserSessionRecord = {
      id: createToken(18),
      userId,
      label,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
      lastSeenAt: timestamp,
      revokedAt: null,
      revokedById: null,
      createdAt: timestamp,
    };
    db.sessions.push(session);
    return session;
  });
}

/**
 * The session behind an id, or null when it no longer opens anything. Revoked and expired
 * sessions resolve to null here, which is what signs a browser holding one back out — and it
 * happens on the next read rather than at some later expiry, so revoking a session from one
 * device ends it on the other.
 */
export function resolveSession(sessionId: string, now = Date.now()): UserSessionRecord | null {
  const session = findSession(sessionId);
  if (!session || effectiveSessionStatus(session, now) !== 'ACTIVE') return null;
  return session;
}

/**
 * Records that a session is still in use, at most once a minute. Returns whether it wrote,
 * so a caller can tell an ordinary render from one that changed the store.
 */
export function touchSession(sessionId: string, now = Date.now()): boolean {
  const session = resolveSession(sessionId, now);
  if (!session) return false;
  if (now - Date.parse(session.lastSeenAt) < SESSION_TOUCH_INTERVAL_MS) return false;

  mutate(() => {
    session.lastSeenAt = new Date(now).toISOString();
  });
  return true;
}

function sessionsOf(userId: string): UserSessionRecord[] {
  return getDatabase().sessions.filter((session) => session.userId === userId);
}

/**
 * Your own sessions, newest first. This needs no permission beyond being signed in: the
 * fastest way for a stolen session to be noticed is for its owner to be shown a list of the
 * devices signed in as them.
 */
export function listOwnSessions(
  actor: Actor,
  rawQuery: ListSessionsQuery = {},
): PaginatedResult<UserSessionView> {
  const current = requireActor(actor);
  const query = parseInput(listSessionsQuerySchema, rawQuery);

  const matching = sessionsOf(current.id).filter(
    (session) => !query.status || effectiveSessionStatus(session) === query.status,
  );

  return paginate(
    sortNewestFirst(matching).map((session) => toSessionView(session, current.sessionId)),
    query,
  );
}

/**
 * Ends one session. Its own owner may always end it; nobody else may, short of the platform
 * admin whose job the account screens already are. A session that has already lapsed is left
 * exactly as it is rather than being stamped again, so the record keeps saying when it
 * actually ended.
 */
export function revokeSession(actor: Actor, sessionId: string): UserSessionView {
  const current = requireActor(actor);

  const session = findSession(sessionId);
  if (!session) {
    throw new NotFoundError('Session not found');
  }
  if (session.userId !== current.id && current.role !== 'ADMIN') {
    throw new ForbiddenError('You do not have permission to perform this action');
  }

  if (effectiveSessionStatus(session) === 'ACTIVE') {
    mutate(() => {
      session.revokedAt = nowIso();
      session.revokedById = current.id;
    });

    recordAuditLog({
      actorId: current.id,
      action: 'user.session_revoked',
      targetType: 'user_session',
      targetId: session.id,
      metadata: { userId: session.userId, label: session.label },
    });
  }

  return toSessionView(session, current.sessionId);
}

/**
 * Revokes every live session an account has, optionally sparing one. Returns how many were
 * actually ended, which is what the screens report back — "signed 3 devices out" is a
 * sentence somebody can check against what they expected.
 */
export function revokeSessionsForUser(
  actorId: string | null,
  userId: string,
  options: { exceptSessionId?: string | undefined } = {},
): number {
  const live = sessionsOf(userId).filter(
    (session) =>
      session.id !== options.exceptSessionId && effectiveSessionStatus(session) === 'ACTIVE',
  );
  if (live.length === 0) return 0;

  mutate(() => {
    const timestamp = nowIso();
    live.forEach((session) => {
      session.revokedAt = timestamp;
      session.revokedById = actorId;
    });
  });

  return live.length;
}

/**
 * "Sign out everywhere else." The session making the request is spared, since somebody
 * clearing an old laptop off the list should not have to sign back in on the machine they
 * are sitting at — and would have no way of telling that outcome from a bug.
 */
export function revokeOtherSessions(actor: Actor): number {
  const current = requireActor(actor);
  const revoked = revokeSessionsForUser(current.id, current.id, {
    exceptSessionId: current.sessionId,
  });

  if (revoked > 0) {
    recordAuditLog({
      actorId: current.id,
      action: 'user.sessions_revoked',
      targetType: 'user',
      targetId: current.id,
      metadata: { revoked },
    });
  }

  return revoked;
}

/** Ends the session a browser is holding, without needing an actor to have been resolved. */
export function endSession(sessionId: string): void {
  const session = findSession(sessionId);
  if (!session || effectiveSessionStatus(session) !== 'ACTIVE') return;

  mutate(() => {
    session.revokedAt = nowIso();
    session.revokedById = session.userId;
  });
}

/** Drops every session belonging to an account, for when the account itself goes. */
export function deleteSessionsForUser(userId: string): void {
  mutate((db) => {
    db.sessions = db.sessions.filter((session) => session.userId !== userId);
  });
}

/**
 * Marks the sessions that reached their expiry while nobody was looking, and reports how
 * many moved. Reads already derive this, so nothing on screen depends on the sweep having
 * run; what it fixes is the stored rows drifting from the truth the screens show, exactly as
 * the invite and API key sweeps do.
 */
export function expireStaleSessions(now = Date.now()): number {
  const stale = getDatabase().sessions.filter(
    (session) => !session.revokedAt && Date.parse(session.expiresAt) <= now,
  );
  if (stale.length === 0) return 0;

  mutate(() => {
    stale.forEach((session) => {
      session.revokedAt = session.expiresAt;
      session.revokedById = null;
    });
  });

  return stale.length;
}

/** One account's sessions, for an administrator looking into a compromised account. */
export function listSessionsForUser(
  actor: Actor,
  userId: string,
  rawQuery: ListSessionsQuery = {},
): PaginatedResult<UserSessionView> {
  const current = requireActor(actor);
  if (current.id !== userId && current.role !== 'ADMIN') {
    throw new ForbiddenError('You do not have permission to perform this action');
  }

  const query = parseInput(listSessionsQuerySchema, rawQuery);
  const matching = sessionsOf(userId).filter(
    (session) => !query.status || effectiveSessionStatus(session) === query.status,
  );

  return paginate(
    sortNewestFirst(matching).map((session) => toSessionView(session, current.sessionId)),
    query,
  );
}
