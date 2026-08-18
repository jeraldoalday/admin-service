import { useState, type ReactNode } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useSession } from '@/app/sessionContext';
import { useLiveQuery } from '@/app/store';
import { PageHeader } from '@/components/Layout';
import { Card, ErrorNotice, SuccessNotice } from '@/components/ui';
import { teams, toErrorMessage } from '@/domain';
import { relativeExpiry } from '@/lib/format';

/**
 * The landing page for an invite link. Accepting requires being signed in as the account the
 * invite was addressed to, so an unauthenticated visitor is routed to sign-in and returned
 * here afterwards.
 */
export function AcceptInvitePage(): ReactNode {
  const { token = '' } = useParams();
  const { user, actor } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<{ id: string; name: string } | null>(null);

  const invite = useLiveQuery(() => teams.findInviteByToken(token));

  if (!user || !actor) {
    return <Navigate to="/sign-in" state={{ from: `/invites/${token}` }} replace />;
  }

  function handleAccept(): void {
    if (!actor) return;
    setError(null);
    try {
      const team = teams.acceptInvite(actor, token);
      setAccepted({ id: team.id, name: team.name });
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  return (
    <>
      <PageHeader title="Team invite" />
      <Card>
        {!invite ? (
          <ErrorNotice error="This invite link is not valid." />
        ) : accepted ? (
          <SuccessNotice>
            You joined {accepted.name}. <Link to={`/teams/${accepted.id}`}>Open the team</Link>.
          </SuccessNotice>
        ) : (
          <>
            <p>
              You are signed in as <strong>{user.email}</strong>. This invite was issued to{' '}
              <strong>{invite.email}</strong> for the <strong>{invite.role}</strong> role and
              expires {relativeExpiry(invite.expiresAt)}.
            </p>
            <ErrorNotice error={error} />
            <div className="form__actions">
              <Link className="button button--ghost" to="/teams">
                Not now
              </Link>
              <button type="button" className="button button--primary" onClick={handleAccept}>
                Accept invite
              </button>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
