import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { auth, type PublicUser } from '@/domain';
import { SessionContext, type SessionContextValue } from './sessionContext';
import { useLiveQuery } from './store';

const SESSION_KEY = 'admin-service:session';

function readStoredUserId(): string | null {
  try {
    return globalThis.localStorage?.getItem(SESSION_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeStoredUserId(userId: string | null): void {
  try {
    if (userId) globalThis.localStorage?.setItem(SESSION_KEY, userId);
    else globalThis.localStorage?.removeItem(SESSION_KEY);
  } catch {
    // The session simply does not survive a reload when storage is unavailable.
  }
}

/**
 * Holds the signed-in identity. It stands in for the JWT pair the API issued: the session is
 * a user id, and the user behind it is re-read from the store on every render, so
 * deactivating or deleting an account takes effect immediately rather than at token expiry.
 */
export function SessionProvider({
  children,
  initialUserId = null,
}: {
  children: ReactNode;
  initialUserId?: string | null;
}): ReactNode {
  const [userId, setUserId] = useState<string | null>(() => initialUserId ?? readStoredUserId());

  const user = useLiveQuery(() => (userId ? auth.resumeSession(userId) : null));

  // A stored id pointing at an account that has since been deleted or deactivated resolves to
  // no user, which already signs the session out everywhere it matters; this just stops the
  // dead id from being restored on the next reload.
  useEffect(() => {
    if (userId && !user) {
      writeStoredUserId(null);
    }
  }, [userId, user]);

  const signIn = useCallback((email: string, password: string): PublicUser => {
    const signedIn = auth.loginUser({ email, password });
    setUserId(signedIn.id);
    writeStoredUserId(signedIn.id);
    return signedIn;
  }, []);

  const register = useCallback(
    (email: string, password: string, displayName: string): PublicUser => {
      const created = auth.registerUser({ email, password, displayName });
      setUserId(created.id);
      writeStoredUserId(created.id);
      return created;
    },
    [],
  );

  const signOut = useCallback(() => {
    setUserId(null);
    writeStoredUserId(null);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      user,
      actor: user ? { id: user.id, role: user.role } : null,
      signIn,
      register,
      signOut,
    }),
    [user, signIn, register, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
