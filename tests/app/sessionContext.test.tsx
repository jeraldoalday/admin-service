import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { SessionContext, useActor, useSession } from '@/app/sessionContext';
import type { Actor, PublicUser } from '@/domain';

describe('useSession', () => {
  it('throws when used outside a SessionProvider', () => {
    const { result } = renderHook(() => {
      try {
        useSession();
        return null;
      } catch (error) {
        return error;
      }
    });
    expect(result.current).toBeInstanceOf(Error);
    expect((result.current as Error).message).toBe(
      'useSession must be used inside a SessionProvider',
    );
  });
});

describe('useActor', () => {
  it('throws when the session has no signed-in actor', () => {
    const value = {
      user: null as PublicUser | null,
      actor: null as Actor | null,
      signIn: () => {
        throw new Error('not used');
      },
      register: () => {
        throw new Error('not used');
      },
      signOut: () => {},
    };

    const { result } = renderHook(
      () => {
        try {
          return useActor();
        } catch (error) {
          return error;
        }
      },
      {
        wrapper: ({ children }) => (
          <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
        ),
      },
    );

    expect(result.current).toBeInstanceOf(Error);
    expect((result.current as Error).message).toBe(
      'useActor must be used inside an authenticated route',
    );
  });

  it('returns the actor when one is present', () => {
    const actor = { id: 'user-1' } as Actor;
    const value = {
      user: null as PublicUser | null,
      actor,
      signIn: () => {
        throw new Error('not used');
      },
      register: () => {
        throw new Error('not used');
      },
      signOut: () => {},
    };

    const { result } = renderHook(() => useActor(), {
      wrapper: ({ children }) => (
        <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
      ),
    });

    expect(result.current).toBe(actor);
  });
});
