import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useActor } from '@/app/sessionContext';
import { useLiveQuery } from '@/app/store';
import { Pagination } from '@/components/DataTable';
import { PageHeader } from '@/components/Layout';
import { Badge, Card, EmptyState, ErrorNotice, Field } from '@/components/ui';
import { teams, toErrorMessage } from '@/domain';
import { formatDate } from '@/lib/format';

/** The teams the signed-in user belongs to, plus the form that starts a new one. */
export function TeamsPage(): ReactNode {
  const actor = useActor();
  const [page, setPage] = useState(1);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const result = useLiveQuery(() => teams.listTeamsForUser(actor, { page, pageSize: 10 }));

  function handleCreate(event: FormEvent): void {
    event.preventDefault();
    setError(null);
    try {
      teams.createTeam(actor, { name });
      setName('');
      setPage(1);
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  return (
    <>
      <PageHeader
        title="Teams"
        description="Teams are self-service. Anyone can create one, and the creator becomes its owner."
      />

      <Card title="Create a team">
        <form className="form form--inline" onSubmit={handleCreate}>
          <Field label="Team name">
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Platform"
              required
            />
          </Field>
          <button type="submit" className="button button--primary">
            Create team
          </button>
        </form>
        <ErrorNotice error={error} />
      </Card>

      <Card title="Your teams">
        {result.items.length === 0 ? (
          <EmptyState>You are not a member of any team yet.</EmptyState>
        ) : (
          <ul className="list">
            {result.items.map((team) => (
              <li key={team.id} className="list__row">
                <div>
                  <Link to={`/teams/${team.id}`} className="list__primary">
                    {team.name}
                  </Link>
                  <p className="list__meta">
                    <code>{team.slug}</code> · created {formatDate(team.createdAt)}
                  </p>
                </div>
                <Badge tone={team.role === 'MEMBER' ? 'neutral' : 'accent'}>{team.role}</Badge>
              </li>
            ))}
          </ul>
        )}
        <Pagination result={result} onPageChange={setPage} />
      </Card>
    </>
  );
}
