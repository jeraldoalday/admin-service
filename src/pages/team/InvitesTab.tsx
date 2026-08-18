import { useState, type FormEvent, type ReactNode } from 'react';
import { useActor } from '@/app/sessionContext';
import { useLiveQuery } from '@/app/store';
import { DataTable, Pagination } from '@/components/DataTable';
import { Badge, EmptyState, ErrorNotice, Field, SuccessNotice, Toolbar } from '@/components/ui';
import { INVITE_STATUSES, teams, toErrorMessage, type InviteStatus, type TeamRole } from '@/domain';
import { formatDate, relativeExpiry } from '@/lib/format';

const STATUS_TONES: Record<InviteStatus, 'positive' | 'neutral' | 'warning' | 'danger'> = {
  PENDING: 'positive',
  ACCEPTED: 'neutral',
  REVOKED: 'danger',
  EXPIRED: 'warning',
};

export function InvitesTab({ teamId }: { teamId: string }): ReactNode {
  const actor = useActor();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'all' | InviteStatus>('all');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Exclude<TeamRole, 'OWNER'>>('MEMBER');
  const [error, setError] = useState<string | null>(null);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);

  const result = useLiveQuery(() =>
    teams.listInvites(actor, teamId, {
      page,
      pageSize: 10,
      ...(status === 'all' ? {} : { status }),
    }),
  );

  function handleCreate(event: FormEvent): void {
    event.preventDefault();
    setError(null);
    try {
      const invite = teams.createInvite(actor, teamId, { email, role });
      setEmail('');
      setLastInviteLink(`${window.location.origin}/invites/${invite.token}`);
      setPage(1);
    } catch (caught) {
      setLastInviteLink(null);
      setError(toErrorMessage(caught));
    }
  }

  function revoke(inviteId: string): void {
    setError(null);
    try {
      teams.revokeInvite(actor, teamId, inviteId);
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  return (
    <>
      <form className="form form--inline" onSubmit={handleCreate}>
        <Field label="Email">
          <input
            type="email"
            value={email}
            placeholder="person@example.com"
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>
        <Field label="Team role">
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as Exclude<TeamRole, 'OWNER'>)}
          >
            <option value="MEMBER">MEMBER</option>
            <option value="ADMIN">ADMIN</option>
          </select>
        </Field>
        <button type="submit" className="button button--primary">
          Send invite
        </button>
      </form>

      <ErrorNotice error={error} />
      {lastInviteLink && (
        <SuccessNotice>
          Invite created. There is no mail transport here, so share the link yourself:{' '}
          <code className="secret">{lastInviteLink}</code>
        </SuccessNotice>
      )}

      <Toolbar>
        <Field label="Status">
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as 'all' | InviteStatus);
              setPage(1);
            }}
          >
            <option value="all">All statuses</option>
            {INVITE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
      </Toolbar>

      {result.items.length === 0 ? (
        <EmptyState>No invites match this filter.</EmptyState>
      ) : (
        <DataTable columns={['Email', 'Role', 'Status', 'Expires', 'Created', '']}>
          {result.items.map((invite) => (
            <tr key={invite.id}>
              <td>{invite.email}</td>
              <td>
                <Badge tone="neutral">{invite.role}</Badge>
              </td>
              <td>
                <Badge tone={STATUS_TONES[invite.status]}>{invite.status}</Badge>
              </td>
              <td className="cell--muted">{relativeExpiry(invite.expiresAt)}</td>
              <td className="cell--muted">{formatDate(invite.createdAt)}</td>
              <td className="cell--actions">
                {invite.status === 'PENDING' && (
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => revoke(invite.id)}
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
    </>
  );
}
