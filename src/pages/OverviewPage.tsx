import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useActor, useSession } from '@/app/sessionContext';
import { useLiveQuery } from '@/app/store';
import { PageHeader } from '@/components/Layout';
import { Badge, Card, EmptyState } from '@/components/ui';
import { audit, teams, users } from '@/domain';
import { formatDateTime } from '@/lib/format';

function StatTile({ label, value, to }: { label: string; value: number; to: string }): ReactNode {
  return (
    <Link className="stat-tile" to={to}>
      <span className="stat-tile__value">{value}</span>
      <span className="stat-tile__label">{label}</span>
    </Link>
  );
}

/** Landing screen: what the signed-in user has access to, and what changed recently. */
export function OverviewPage(): ReactNode {
  const { user } = useSession();
  const actor = useActor();
  const isAdmin = actor.role === 'ADMIN';

  const myTeams = useLiveQuery(() => teams.listTeamsForUser(actor, { pageSize: 100 }));
  const userCount = useLiveQuery(() =>
    isAdmin ? users.listUsers(actor, { pageSize: 1 }).total : 0,
  );
  const recentActivity = useLiveQuery(() =>
    isAdmin ? audit.listAuditLogs({ pageSize: 6 }).items : [],
  );

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user?.displayName ?? ''}`}
        description={
          isAdmin
            ? 'You are signed in as a platform admin, so user management and the audit log are available.'
            : 'You are signed in as a platform member. Team screens are scoped to the teams you belong to.'
        }
      />

      <div className="stat-row">
        <StatTile label="Teams you belong to" value={myTeams.total} to="/teams" />
        {isAdmin && <StatTile label="Accounts on the platform" value={userCount} to="/users" />}
      </div>

      <Card title="Your teams" description="Team roles are scoped to the team, not the platform.">
        {myTeams.items.length === 0 ? (
          <EmptyState>
            You are not a member of any team yet. <Link to="/teams">Create one</Link> and you become
            its owner.
          </EmptyState>
        ) : (
          <ul className="list">
            {myTeams.items.map((team) => (
              <li key={team.id} className="list__row">
                <Link to={`/teams/${team.id}`} className="list__primary">
                  {team.name}
                </Link>
                <Badge tone={team.role === 'MEMBER' ? 'neutral' : 'accent'}>{team.role}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {isAdmin && (
        <Card
          title="Recent activity"
          description="Every mutation across the console is recorded."
          actions={
            <Link className="button button--ghost" to="/audit-logs">
              View all
            </Link>
          }
        >
          {recentActivity.length === 0 ? (
            <EmptyState>Nothing has happened yet.</EmptyState>
          ) : (
            <ul className="list">
              {recentActivity.map((entry) => (
                <li key={entry.id} className="list__row">
                  <span className="list__primary">
                    <code>{entry.action}</code>
                  </span>
                  <span className="list__meta">{formatDateTime(entry.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
