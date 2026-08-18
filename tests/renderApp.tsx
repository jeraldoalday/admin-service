import type { ReactElement } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { App } from '@/App';
import { SessionProvider } from '@/app/session';

/**
 * Mounts the real application — real routes, real session provider, real domain layer — at a
 * given URL and optionally already signed in. Nothing is mocked: these tests drive the same
 * code paths a person clicking through the console would.
 */
export function renderApp({
  route = '/',
  userId = null,
}: { route?: string; userId?: string | null } = {}): RenderResult & {
  user: ReturnType<typeof userEvent.setup>;
} {
  const result = render(
    <MemoryRouter initialEntries={[route]}>
      <SessionProvider initialUserId={userId}>
        <App />
      </SessionProvider>
    </MemoryRouter>,
  );
  return { ...result, user: userEvent.setup() };
}

/** Mounts a single component inside the providers it expects, for focused component tests. */
export function renderWithProviders(
  element: ReactElement,
  { route = '/', userId = null }: { route?: string; userId?: string | null } = {},
): RenderResult & { user: ReturnType<typeof userEvent.setup> } {
  const result = render(
    <MemoryRouter initialEntries={[route]}>
      <SessionProvider initialUserId={userId}>
        <Routes>
          <Route path="*" element={element} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>,
  );
  return { ...result, user: userEvent.setup() };
}
