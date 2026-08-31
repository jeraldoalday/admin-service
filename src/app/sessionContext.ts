import { createContext, useContext } from 'react';
import type { Actor, PublicUser, SignInResult } from '@/domain';

export interface SessionContextValue {
  user: PublicUser | null;
  /** The session this browser is holding, or null when it is signed out. */
  sessionId: string | null;
  actor: Actor | null;
  /**
   * Weighs a password. It returns what happened rather than an account, because with an
   * authenticator in play "the password was right" and "you are signed in" are two different
   * answers and a caller should not be able to conflate them.
   */
  signIn: (email: string, password: string) => SignInResult;
  /** Answers an outstanding challenge, and opens the session the password did not. */
  completeTwoFactor: (challengeId: string, code: string) => PublicUser;
  register: (email: string, password: string, displayName: string) => PublicUser;
  signOut: () => void;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used inside a SessionProvider');
  }
  return context;
}

/**
 * The signed-in actor, for screens already behind an auth guard that would otherwise have to
 * null-check on every call.
 */
export function useActor(): Actor {
  const { actor } = useSession();
  if (!actor) {
    throw new Error('useActor must be used inside an authenticated route');
  }
  return actor;
}
