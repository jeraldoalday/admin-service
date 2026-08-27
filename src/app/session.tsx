import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { auth, sessions, type PublicUser } from '@/domain';
import { describeDevice } from '@/lib/device';
import { SessionContext, type SessionContextValue } from './sessionContext';
import { useLiveQuery } from './store';

/**
 * The key holds a session id rather than the user id it used to. It is deliberately a new
 * key: an id left behind by the old scheme names an account, not a session, and adopting it
 * would sign somebody in on evidence that no longer means what it says.
 */
const SESSION_KEY = 'admin-service:session-id';

function readStoredSessionId(): string | null {
  try {
    return globalThis.localStorage?.getItem(SESSION_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStoredSessionId(sessionId: string | null): void {
  try {
    if (sessionId) globalThis.localStorage?.setItem(SESSION_KEY, sessionId);
    else globalThis.localStorage?.removeItem(SESSION_KEY);
  } catch {
    // The session simply does not survive a reload when storage is unavailable.
  }
}

/**
 * Holds the signed-in identity.
 *
 * The browser keeps an opaque session id and nothing else. Everything that decides whether
 * that id still opens anything — the session's expiry, whether it has been revoked, whether
 * the account behind it still exists and is still active — is read from the store on every
 * render. So a session revoked from another device, an account deactivated by an admin, and
 * a password changed elsewhere all take effect here on the next render rather than whenever
 * a token would have expired.
 */
export function SessionProvider({
  children,
  initialUserId = null,
}: {
  children: ReactNode;
  /** Signs a given account in as the provider mounts, which is what tests drive it with. */
  initialUserId?: string | null;
}): ReactNode {
  const [sessionId, setSessionId] = useState<string | null>(() => {
    if (initialUserId) return sessions.startSession(initialUserId, describeDevice()).id;
    return readStoredSessionId();
  });

  const user = useLiveQuery(() => {
    if (!sessionId) return null;
    const session = sessions.resolveSession(sessionId);
    return session ? auth.resumeSession(session.userId) : null;
  });

  // A stored id that no longer resolves — revoked, expired, or pointing at an account that
  // has since been deleted or deactivated — already signs the session out everywhere it
  // matters. This just stops the dead id being restored on the next reload.
  useEffect(() => {
    if (sessionId && !user) {
      writeStoredSessionId(null);
    }
  }, [sessionId, user]);

  // Keeps the session's last-seen stamp roughly current, so the sessions list can say which
  // device was actually being used and which has been sitting idle since Tuesday. The domain
  // throttles the write to at most once a minute; without that floor this would be a store
  // mutation per render, and the store notifies on every mutation.
  useEffect(() => {
    if (!sessionId) return;
    sessions.touchSession(sessionId);

    const timer = setInterval(() => {
      sessions.touchSession(sessionId);
    }, sessions.SESSION_TOUCH_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [sessionId]);

  const openSession = useCallback((userId: string): void => {
    const opened = sessions.startSession(userId, describeDevice());
    setSessionId(opened.id);
    writeStoredSessionId(opened.id);
  }, []);

  const signIn = useCallback(
    (email: string, password: string): PublicUser => {
      const signedIn = auth.loginUser({ email, password });
      openSession(signedIn.id);
      return signedIn;
    },
    [openSession],
  );

  const register = useCallback(
    (email: string, password: string, displayName: string): PublicUser => {
      const created = auth.registerUser({ email, password, displayName });
      openSession(created.id);
      return created;
    },
    [openSession],
  );

  // Signing out ends the session rather than merely forgetting it: an id that is still good
  // and merely dropped from this browser is a session nobody can see and nobody can end.
  const signOut = useCallback(() => {
    if (sessionId) sessions.endSession(sessionId);
    setSessionId(null);
    writeStoredSessionId(null);
  }, [sessionId]);

  const value = useMemo<SessionContextValue>(
    () => ({
      user,
      sessionId,
      actor: user ? { id: user.id, role: user.role, ...(sessionId ? { sessionId } : {}) } : null,
      signIn,
      register,
      signOut,
    }),
    [user, sessionId, signIn, register, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
