import { createContext, useContext } from 'react';
import type { Actor, PublicUser } from '@/domain';

export interface SessionContextValue {
  user: PublicUser | null;
  actor: Actor | null;
  signIn: (email: string, password: string) => PublicUser;
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
