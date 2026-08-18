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

export function DataTable({
  columns,
  children,
}: {
  columns: string[];
  children: ReactNode;
}): ReactNode {
  return (
    <div className="table__scroll">
      <table className="table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
