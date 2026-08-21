import type { ReactNode } from 'react';
import type { PaginatedResult } from '@/domain';

/** Page navigation for a `PaginatedResult`, hidden entirely when there is only one page. */
export function Pagination<T>({
  result,
  onPageChange,
}: {
  result: PaginatedResult<T>;
  onPageChange: (page: number) => void;
}): ReactNode {
  if (result.totalPages <= 1) return null;

  return (
    <nav className="pagination" aria-label="Pagination">
      <button
        type="button"
        className="button button--ghost"
        onClick={() => onPageChange(result.page - 1)}
        disabled={result.page <= 1}
      >
        Previous
      </button>
      <span className="pagination__status">
        Page {result.page} of {result.totalPages} · {result.total} total
      </span>
      <button
        type="button"
        className="button button--ghost"
        onClick={() => onPageChange(result.page + 1)}
        disabled={result.page >= result.totalPages}
      >
        Next
      </button>
    </nav>
  );
}

/** A column that can be ordered by, identified by the key the domain query understands. */
export interface TableColumn {
  label: string;
  sortKey?: string;
}

export interface TableSort {
  key: string;
  direction: 'asc' | 'desc';
  onChange: (key: string) => void;
}

function toColumn(column: string | TableColumn): TableColumn {
  return typeof column === 'string' ? { label: column } : column;
}

const ARROWS = { asc: '\u2191', desc: '\u2193' } as const;

/**
 * A table whose headers can order it.
 *
 * Sortable headers are buttons inside the `th` rather than click handlers on the cell, so
 * they can be reached and fired from the keyboard, and the `th` carries `aria-sort` so a
 * screen reader announces which column the table is ordered by and in which direction — the
 * arrow alone says that only to somebody looking at it. Columns without a `sortKey` render
 * as plain headers, which is what an actions column wants.
 */
export function DataTable({
  columns,
  sort,
  children,
}: {
  columns: (string | TableColumn)[];
  sort?: TableSort;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="table__scroll">
      <table className="table">
        <thead>
          <tr>
            {columns.map(toColumn).map((column) => {
              const active = sort && column.sortKey === sort.key;
              return (
                <th
                  key={column.label}
                  scope="col"
                  aria-sort={
                    active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                >
                  {sort && column.sortKey ? (
                    <button
                      type="button"
                      className={`table__sort${active ? ' is-active' : ''}`}
                      onClick={() => sort.onChange(column.sortKey as string)}
                    >
                      {column.label}
                      <span aria-hidden="true" className="table__sort-arrow">
                        {active ? ARROWS[sort.direction] : ''}
                      </span>
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
