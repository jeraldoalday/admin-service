import { useState, type ReactNode } from 'react';
import { useLiveQuery } from '@/app/store';
import { DataTable, Pagination } from '@/components/DataTable';
import { PageHeader } from '@/components/Layout';
import { Card, EmptyState, Field, Toolbar } from '@/components/ui';
import { audit } from '@/domain';
import { formatDateTime } from '@/lib/format';

/** Admin-only, read-only history of every mutation the console has performed. */
export function AuditLogPage(): ReactNode {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [targetType, setTargetType] = useState('');

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

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Append-only. Entries are written by the domain layer, not by the screens."
      />

      <Card>
        <Toolbar>
          <Field label="Action">
            <select
              value={action}
              onChange={(event) => {
                setAction(event.target.value);
                setPage(1);
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
