import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useSession } from '@/app/sessionContext';

interface NavItem {
  to: string;
  label: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview' },
  { to: '/teams', label: 'Teams' },
  { to: '/users', label: 'Users', adminOnly: true },
  { to: '/audit-logs', label: 'Audit log', adminOnly: true },
];

/** The signed-in shell: navigation on the left, the active screen on the right. */
export function Layout(): ReactNode {
  const { user, signOut } = useSession();

  return (
    <div className="shell">
      <aside className="shell__sidebar">
        <div className="shell__brand">
          <span className="shell__brand-mark">as</span>
          <span>admin-service</span>
        </div>
        <nav className="shell__nav" aria-label="Main">
          {NAV_ITEMS.filter((item) => !item.adminOnly || user?.role === 'ADMIN').map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `shell__nav-link${isActive ? ' is-active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        {user && (
          <div className="shell__account">
            <div>
              <p className="shell__account-name">{user.displayName}</p>
              <p className="shell__account-email">{user.email}</p>
            </div>
            <button type="button" className="button button--ghost" onClick={signOut}>
              Sign out
            </button>
          </div>
        )}
      </aside>
      <main className="shell__main">
        <Outlet />
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}): ReactNode {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {description && <p className="page-header__description">{description}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}
