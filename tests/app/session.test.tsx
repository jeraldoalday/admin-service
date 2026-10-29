import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SessionProvider } from '@/app/session';
import { useSession } from '@/app/sessionContext';
import { adminActor } from '../helpers';

const SESSION_KEY = 'admin-service:session';

function SessionProbe() {
  const { user } = useSession();
  return <div data-testid="probe">{user ? user.id : 'signed-out'}</div>;
}

describe('SessionProvider', () => {
  it('resumes a session from a user id already in storage', () => {
    localStorage.setItem(SESSION_KEY, adminActor().id);

    render(
      <SessionProvider>
        <SessionProbe />
      </SessionProvider>,
    );

    expect(screen.getByTestId('probe')).toHaveTextContent(adminActor().id);
  });

  it('clears a stored session id for an account that no longer exists', async () => {
    localStorage.setItem(SESSION_KEY, 'deleted-user-id');

    render(
      <SessionProvider>
        <SessionProbe />
      </SessionProvider>,
    );

    expect(screen.getByTestId('probe')).toHaveTextContent('signed-out');
    await waitFor(() => expect(localStorage.getItem(SESSION_KEY)).toBeNull());
  });

  it('starts signed out when storage access itself throws', () => {
    const original = Object.getOwnPropertyDescriptor(Storage.prototype, 'getItem');
    Object.defineProperty(Storage.prototype, 'getItem', {
      configurable: true,
      value: () => {
        throw new Error('storage disabled');
      },
    });

    try {
      render(
        <SessionProvider>
          <SessionProbe />
        </SessionProvider>,
      );
      expect(screen.getByTestId('probe')).toHaveTextContent('signed-out');
    } finally {
      if (original) Object.defineProperty(Storage.prototype, 'getItem', original);
    }
  });
});
