import { useState, type ReactNode } from 'react';
import { useActor } from '@/app/sessionContext';
import { useLiveQuery, useLiveResult } from '@/app/store';
import { DataTable, Pagination } from '@/components/DataTable';
import { EmptyState, ErrorNotice, Field, SuccessNotice, Toolbar } from '@/components/ui';
import { audit, toErrorMessage, type AuditLogFilters } from '@/domain';
import { downloadTextFile, toCsv } from '@/lib/csv';
import { formatDateTime } from '@/lib/format';

/**
 * One team's slice of the audit log, for the people who run that team.
 *
 * It reads through the team-scoped domain calls rather than the platform-wide ones, so the
 * screen cannot show more than the caller is entitled to even if it asked to: the team id is
 * applied by the domain, not by the filter object assembled here.
 */
export function ActivityTab({ teamId }: { teamId: string }): ReactNode {
  const actor = useActor();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [actorId, setActorId] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exported, setExported] = useState<number | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const filters: AuditLogFilters = {
    ...(action ? { action } : {}),
    ...(targetType ? { targetType } : {}),
    ...(actorId ? { actorId } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  const hasFilters = Object.keys(filters).length > 0;

  const result = useLiveResult(() =>
    audit.listTeamActivity(actor, teamId, { ...filters, page, pageSize: 10 }),
  );
  const actions = useLiveQuery(() => audit.listTeamActivityActions(actor, teamId));
  const targetTypes = useLiveQuery(() => audit.listTeamActivityTargetTypes(actor, teamId));
  const actors = useLiveQuery(() => audit.listTeamActivityActors(actor, teamId));
  const actorLabels = new Map(actors.map((candidate) => [candidate.id, candidate.label]));

  function changeFilter(apply: () => void): void {
    apply();
    setPage(1);
    setExported(null);
    setExportError(null);
  }

  function clearFilters(): void {
    changeFilter(() => {
      setAction('');
      setTargetType('');
      setActorId('');
      setSearch('');
      setFrom('');
      setTo('');
    });
  }

  function describeActor(id: string | null): string {
    if (!id) return 'system';
    return actorLabels.get(id) ?? id;
  }

  /** Everything the filters match, not the ten rows on screen. */
  function exportMatching(): void {
    setExportError(null);
    try {
      const matching = audit.listAllTeamActivity(actor, teamId, filters);

      const csv = toCsv(matching, [
        { header: 'Timestamp', value: (entry) => entry.createdAt },
        { header: 'Action', value: (entry) => entry.action },
        { header: 'Actor', value: (entry) => describeActor(entry.actorId) },
        { header: 'Actor ID', value: (entry) => entry.actorId },
        { header: 'Target type', value: (entry) => entry.targetType },
        { header: 'Target', value: (entry) => entry.targetId },
        { header: 'Details', value: (entry) => entry.metadata },
      ]);

      downloadTextFile('team-activity.csv', csv, 'text/csv');
      setExported(matching.length);
    } catch (caught) {
      setExported(null);
      setExportError(toErrorMessage(caught));
    }
  }

  return (
    <>
      <p className="card__description">
        Everything the console has recorded for this team — memberships, invites, permission grants,
        and API keys. Written by the domain layer, and no more editable from here than the platform
        log is.
      </p>

      <Toolbar>
        <Field label="Action">
          <select
            value={action}
            onChange={(event) => changeFilter(() => setAction(event.target.value))}
          >
            <option value="">All actions</option>
            {actions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Target type">
          <select
            value={targetType}
            onChange={(event) => changeFilter(() => setTargetType(event.target.value))}
          >
            <option value="">All targets</option>
            {targetTypes.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Actor">
          <select
            value={actorId}
            onChange={(event) => changeFilter(() => setActorId(event.target.value))}
          >
            <option value="">Anyone</option>
            {actors.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Search" hint="Matches the action, the target, and the details.">
          <input
            type="search"
            value={search}
            placeholder="e.g. an email address"
            onChange={(event) => changeFilter(() => setSearch(event.target.value))}
          />
        </Field>
        <Field label="From">
          <input
            type="date"
            value={from}
            onChange={(event) => changeFilter(() => setFrom(event.target.value))}
          />
        </Field>
        <Field label="To" hint="Both dates count as whole days.">
          <input
            type="date"
            value={to}
            onChange={(event) => changeFilter(() => setTo(event.target.value))}
          />
        </Field>
        {hasFilters && (
          <button type="button" className="button button--ghost" onClick={clearFilters}>
            Clear filters
          </button>
        )}
        <button type="button" className="button" onClick={exportMatching}>
          Export CSV
        </button>
      </Toolbar>

      <ErrorNotice error={result.error?.message ?? exportError} />

      {exported !== null && (
        <SuccessNotice>
          Exported {exported} {exported === 1 ? 'entry' : 'entries'} to team-activity.csv.
        </SuccessNotice>
      )}

      {!result.data ? null : result.data.items.length === 0 ? (
        <EmptyState>
          {hasFilters ? 'No entries match these filters.' : 'Nothing has happened here yet.'}
        </EmptyState>
      ) : (
        <>
          <DataTable columns={['When', 'Action', 'Actor', 'Target', 'Details']}>
            {result.data.items.map((entry) => (
              <tr key={entry.id}>
                <td className="cell--muted">{formatDateTime(entry.createdAt)}</td>
                <td>
                  <code>{entry.action}</code>
                </td>
                <td className="cell--muted">{describeActor(entry.actorId)}</td>
                <td className="cell--muted">
                  {entry.targetType}
                  {entry.targetId ? ` · ${entry.targetId}` : ''}
                </td>
                <td className="cell--muted">
                  {entry.metadata ? <code>{JSON.stringify(entry.metadata)}</code> : '—'}
                </td>
              </tr>
            ))}
          </DataTable>

          <Pagination result={result.data} onPageChange={setPage} />
        </>
      )}
    </>
  );
}
