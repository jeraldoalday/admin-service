import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useSession } from '@/app/sessionContext';
import { Layout, PageHeader } from '@/components/Layout';
import { Card } from '@/components/ui';
import { AcceptInvitePage } from '@/pages/AcceptInvitePage';
import { AccountPage } from '@/pages/AccountPage';
import { AuditLogPage } from '@/pages/AuditLogPage';
import { OverviewPage } from '@/pages/OverviewPage';
import { SignInPage } from '@/pages/SignInPage';
import { TeamsPage } from '@/pages/TeamsPage';
import { UsersPage } from '@/pages/UsersPage';
import { TeamDetailPage } from '@/pages/team/TeamDetailPage';

/** Sends signed-out visitors to sign-in, remembering where they were headed. */
function RequireAuth({ children }: { children: ReactNode }): ReactNode {
  const { user } = useSession();
  const location = useLocation();

  if (!user) {
    return <Navigate to="/sign-in" state={{ from: location.pathname }} replace />;
  }
  return children;
}

/** Platform-admin screens. The domain refuses these calls anyway; this keeps the UI honest. */
function RequireAdmin({ children }: { children: ReactNode }): ReactNode {
  const { user } = useSession();

  if (user?.role !== 'ADMIN') {
    return (
      <>
        <PageHeader title="Not available" />
        <Card>
          <p>This area is limited to platform admins.</p>
        </Card>
      </>
    );
  }
  return children;
}

export function App(): ReactNode {
  return (
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<OverviewPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="teams/:teamId" element={<TeamDetailPage />} />
        <Route path="invites/:token" element={<AcceptInvitePage />} />
        <Route
          path="users"
          element={
            <RequireAdmin>
              <UsersPage />
            </RequireAdmin>
          }
        />
        <Route
          path="audit-logs"
          element={
            <RequireAdmin>
              <AuditLogPage />
            </RequireAdmin>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
