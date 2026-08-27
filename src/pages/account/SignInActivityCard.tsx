import { useState, type ReactNode } from 'react';
import { useActor, useSession } from '@/app/sessionContext';
import { useLiveQuery } from '@/app/store';
import { DataTable, Pagination } from '@/components/DataTable';
import { Badge, Card, EmptyState } from '@/components/ui';
import { lockout, type SignInOutcome } from '@/domain';
import { formatDateTime } from '@/lib/format';

const OUTCOME_TONE: Record<SignInOutcome, 'positive' | 'danger' | 'warning'> = {
  SUCCEEDED: 'positive',
  FAILED: 'danger',
  BLOCKED: 'warning',
};

const OUTCOME_LABEL: Record<SignInOutcome, string> = {
  SUCCEEDED: 'Signed in',
  FAILED: 'Failed',
  BLOCKED: 'Blocked',
};

/**
 * Recent attempts to sign in as you, successful or not.
 *
 * Showing this to the account holder rather than only to an administrator is the point: a
 * password that has leaked shows up here as failures the owner knows they did not make, and
 * the owner is both the first person to notice and the one who can do something about it in
 * the next thirty seconds by changing it.
 */
export function SignInActivityCard(): ReactNode {
  const actor = useActor();
  const { user } = useSession();
  const [page, setPage] = useState(1);

  const result = useLiveQuery(() => lockout.listOwnSignInAttempts(actor, { page, pageSize: 5 }));
  const lock = useLiveQuery(() => (user ? lockout.lockStateFor(user.email) : null));

  return (
    <Card
      title="Recent sign-in attempts"
      description="Attempts made against your email address, whether or not they worked."
    >
      {lock && lock.failedAttempts > 0 && (
        <p
          className={`notice ${lock.isLocked ? 'notice--error' : 'notice--warning'}`}
          role="status"
        >
          {lock.isLocked
            ? `Your account is locked after ${lock.failedAttempts} failed attempts. It unlocks at ${formatDateTime(lock.lockedUntil)}.`
            : `${lock.failedAttempts} recent ${lock.failedAttempts === 1 ? 'attempt has' : 'attempts have'} failed. ${lock.retriesRemaining} more will lock the account.`}
        </p>
      )}

      {result.items.length === 0 ? (
        <EmptyState>Nothing has tried to sign in as you recently.</EmptyState>
      ) : (
        <DataTable columns={['Outcome', 'When']}>
          {result.items.map((attempt) => (
            <tr key={attempt.id}>
              <td>
                <Badge tone={OUTCOME_TONE[attempt.outcome]}>{OUTCOME_LABEL[attempt.outcome]}</Badge>
                {attempt.clearedAt && <span className="cell--tag">cleared</span>}
              </td>
              <td className="cell--muted">{formatDateTime(attempt.createdAt)}</td>
            </tr>
          ))}
        </DataTable>
      )}

      <Pagination result={result} onPageChange={setPage} />
    </Card>
  );
}
