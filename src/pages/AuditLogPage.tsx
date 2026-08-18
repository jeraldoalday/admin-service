import { useState, type ReactNode } from 'react';
import { useLiveQuery } from '@/app/store';
import { DataTable, Pagination } from '@/components/DataTable';
import { PageHeader } from '@/components/Layout';
import { Card, EmptyState, Field, SuccessNotice, Toolbar } from '@/components/ui';
import { audit } from '@/domain';
import { toCsv, downloadTextFile } from '@/lib/csv';
import { formatDateTime } from '@/lib/format';

/** Admin-only, read-only history of every mutation the console has performed. */
export function AuditLogPage(): ReactNode {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');
  const [exported, setExported] = useState<number | null>(null);

  const result = useLiveQuery(() =>
    audit.listAuditLogs({
      page,
      pageSize: 15,
      ...(action ? { action } : {}),
      ...(targetType ? { targetType } : {}),
    }),
  );
  const actions = useLiveQuery(() => audit.listAuditActions());
  const targetTypes = useLiveQuery(() => audit.listAuditTargetTypes());

  /**
   * Exports everything the current filters match, not just the page on screen - an export
   * that silently stopped at fifteen rows would be worse than no export at all. It reads
   * through the unpaginated list for the same reason: a page caps out at a hundred rows.
   */
  function exportMatching(): void {
    const matching = audit.listAllAuditLogs({
      ...(action ? { action } : {}),
      ...(targetType ? { targetType } : {}),
    });

    const csv = toCsv(matching, [
      { header: 'Timestamp', value: (entry) => entry.createdAt },
      { header: 'Action', value: (entry) => entry.action },
      { header: 'Actor', value: (entry) => entry.actorId },
      { header: 'Target type', value: (entry) => entry.targetType },
      { header: 'Target', value: (entry) => entry.targetId },
      { header: 'Details', value: (entry) => entry.metadata },
    ]);

    downloadTextFile('audit-log.csv', csv, 'text/csv');
    setExported(matching.length);
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
              onChange={(event) => {
                setAction(event.target.value);
                setPage(1);
                setExported(null);
              }}
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
              onChange={(event) => {
                setTargetType(event.target.value);
                setPage(1);
                setExported(null);
              }}
            >
              <option value="">All targets</option>
              {targetTypes.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
        </Toolbar>

        {exported !== null && (
          <SuccessNotice>
            Exported {exported} {exported === 1 ? 'entry' : 'entries'} to audit-log.csv.
          </SuccessNotice>
        )}

        {result.items.length === 0 ? (
          <EmptyState>No entries match these filters.</EmptyState>
        ) : (
          <DataTable columns={['When', 'Action', 'Target', 'Details']}>
            {result.items.map((entry) => (
              <tr key={entry.id}>
                <td className="cell--muted">{formatDateTime(entry.createdAt)}</td>
                <td>
                  <code>{entry.action}</code>
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
        )}

        <Pagination result={result} onPageChange={setPage} />
      </Card>
    </>
  );
}
