import { useState, type ReactNode } from 'react';
import { useLiveQuery, useLiveResult } from '@/app/store';
import { DataTable, Pagination } from '@/components/DataTable';
import { PageHeader } from '@/components/Layout';
import { Card, EmptyState, ErrorNotice, Field, SuccessNotice, Toolbar } from '@/components/ui';
import { audit, toErrorMessage, type AuditLogFilters } from '@/domain';
import { toCsv, downloadTextFile } from '@/lib/csv';
import { formatDateTime } from '@/lib/format';

/** Admin-only, read-only history of every mutation the console has performed. */
export function AuditLogPage(): ReactNode {
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

  // A range that ends before it starts is a rejection, not a crash: the domain refuses it and
  // the screen says so while leaving the controls exactly as the reader left them.
  const result = useLiveResult(() => audit.listAuditLogs({ ...filters, page, pageSize: 15 }));
  const actions = useLiveQuery(() => audit.listAuditActions());
  const targetTypes = useLiveQuery(() => audit.listAuditTargetTypes());
  const actors = useLiveQuery(() => audit.listAuditActors());
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

  /**
   * Exports everything the current filters match, not just the page on screen - an export
   * that silently stopped at fifteen rows would be worse than no export at all. It reads
   * through the unpaginated list for the same reason: a page caps out at a hundred rows.
   */
  function exportMatching(): void {
    setExportError(null);
    try {
      const matching = audit.listAllAuditLogs(filters);

      const csv = toCsv(matching, [
        { header: 'Timestamp', value: (entry) => entry.createdAt },
        { header: 'Action', value: (entry) => entry.action },
        {
          header: 'Actor',
          value: (entry) =>
            entry.actorId ? (actorLabels.get(entry.actorId) ?? entry.actorId) : '',
        },
        { header: 'Actor ID', value: (entry) => entry.actorId },
        { header: 'Target type', value: (entry) => entry.targetType },
        { header: 'Target', value: (entry) => entry.targetId },
        { header: 'Details', value: (entry) => entry.metadata },
      ]);

      downloadTextFile('audit-log.csv', csv, 'text/csv');
      setExported(matching.length);
    } catch (caught) {
      setExported(null);
      setExportError(toErrorMessage(caught));
    }
  }

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only. Entries are written by the domain layer, not by the screens."
        actions={
          <button type="button" className="button" onClick={exportMatching}>
            Export CSV
          </button>
        }
      />

      <Card>
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
        </Toolbar>

        <ErrorNotice error={result.error?.message ?? exportError} />

        {exported !== null && (
          <SuccessNotice>
            Exported {exported} {exported === 1 ? 'entry' : 'entries'} to audit-log.csv.
          </SuccessNotice>
        )}

        {!result.data ? null : result.data.items.length === 0 ? (
          <EmptyState>No entries match these filters.</EmptyState>
        ) : (
          <>
            <DataTable columns={['When', 'Action', 'Actor', 'Target', 'Details']}>
              {result.data.items.map((entry) => (
                <tr key={entry.id}>
                  <td className="cell--muted">{formatDateTime(entry.createdAt)}</td>
                  <td>
                    <code>{entry.action}</code>
                  </td>
                  <td className="cell--muted">
                    {entry.actorId ? (actorLabels.get(entry.actorId) ?? entry.actorId) : 'system'}
                  </td>
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
      </Card>
    </>
  );
}
