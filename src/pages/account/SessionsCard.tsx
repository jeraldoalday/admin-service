import { useState, type ReactNode } from 'react';
import { useActor } from '@/app/sessionContext';
import { useLiveQuery } from '@/app/store';
import { DataTable, Pagination } from '@/components/DataTable';
import { Badge, Card, EmptyState, ErrorNotice, SuccessNotice } from '@/components/ui';
import { sessions, toErrorMessage, type SessionStatus, type UserSessionView } from '@/domain';
import { formatDateTime } from '@/lib/format';

const STATUS_TONE: Record<SessionStatus, 'positive' | 'neutral' | 'warning'> = {
  ACTIVE: 'positive',
  REVOKED: 'neutral',
  EXPIRED: 'warning',
};

/**
 * The devices signed in as you.
 *
 * Revoked and expired sessions stay on the list rather than disappearing once they stop
 * working. A list of only the live ones answers "who is signed in?" but not "was anybody
 * signed in that I did not recognise?", and the second question is the one somebody opens
 * this panel to ask.
 */
export function SessionsCard(): ReactNode {
  const actor = useActor();
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [revoked, setRevoked] = useState<number | null>(null);

  const result = useLiveQuery(() => sessions.listOwnSessions(actor, { page, pageSize: 5 }));
  const others = result.items.filter(
    (session) => session.status === 'ACTIVE' && !session.isCurrent,
  );

  function revokeOne(session: UserSessionView): void {
    setError(null);
    setRevoked(null);
    try {
      sessions.revokeSession(actor, session.id);
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  function revokeOthers(): void {
    setError(null);
    try {
      setRevoked(sessions.revokeOtherSessions(actor));
    } catch (caught) {
      setRevoked(null);
      setError(toErrorMessage(caught));
    }
  }

  return (
    <Card
      title="Signed-in devices"
      description="Every session opened against your account, including the ones already ended."
      actions={
        others.length > 0 && (
          <button type="button" className="button" onClick={revokeOthers}>
            Sign out other devices
          </button>
        )
      }
    >
      <ErrorNotice error={error} />

      {revoked !== null && (
        <SuccessNotice>
          {revoked === 0
            ? 'There were no other devices left to sign out.'
            : `Signed out ${revoked} other ${revoked === 1 ? 'device' : 'devices'}.`}
        </SuccessNotice>
      )}

      {result.items.length === 0 ? (
        <EmptyState>No sessions have been opened against this account.</EmptyState>
      ) : (
        <DataTable columns={['Device', 'Status', 'Started', 'Last seen', '']}>
          {result.items.map((session) => (
            <tr key={session.id}>
              <td>
                {session.label}
                {session.isCurrent && <span className="cell--tag">this device</span>}
              </td>
              <td>
                <Badge tone={STATUS_TONE[session.status]}>{session.status}</Badge>
              </td>
              <td className="cell--muted">{formatDateTime(session.createdAt)}</td>
              <td className="cell--muted">{formatDateTime(session.lastSeenAt)}</td>
              <td className="cell--actions">
                {session.status === 'ACTIVE' && !session.isCurrent && (
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => revokeOne(session)}
                  >
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      )}

      <Pagination result={result} onPageChange={setPage} />
    </Card>
  );
}
