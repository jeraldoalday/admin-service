import { useState, type FormEvent, type ReactNode } from 'react';
import { useActor } from '@/app/sessionContext';
import { useLiveQuery } from '@/app/store';
import { DataTable, Pagination } from '@/components/DataTable';
import { PageHeader } from '@/components/Layout';
import {
  Badge,
  Card,
  EmptyState,
  ErrorNotice,
  Field,
  Modal,
  SuccessNotice,
  Toolbar,
} from '@/components/ui';
import {
  toErrorMessage,
  users,
  type AdminUserView,
  type SortDirection,
  type UpdateUserInput,
  type UserFilters,
  type UserRole,
  type UserSortField,
} from '@/domain';
import { downloadTextFile, toCsv } from '@/lib/csv';
import { formatDate } from '@/lib/format';

type ActiveFilter = 'all' | 'true' | 'false';

/**
 * The direction a column starts in when it is first clicked. Dates open newest-first, since
 * "who joined recently" is the question a date column is usually being asked; names and
 * roles open A-to-Z, which is the order a reader scanning for one is expecting.
 */
const INITIAL_DIRECTION: Record<UserSortField, SortDirection> = {
  createdAt: 'desc',
  displayName: 'asc',
  email: 'asc',
  role: 'asc',
};

const COLUMNS = [
  { label: 'Name', sortKey: 'displayName' },
  { label: 'Email', sortKey: 'email' },
  { label: 'Role', sortKey: 'role' },
  { label: 'Status' },
  { label: 'Joined', sortKey: 'createdAt' },
  { label: '' },
];

/** Admin-only account management: search, filter, edit, and delete platform accounts. */
export function UsersPage(): ReactNode {
  const actor = useActor();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<'all' | UserRole>('all');
  const [isActive, setIsActive] = useState<ActiveFilter>('all');
  const [sort, setSort] = useState<UserSortField>('createdAt');
  const [direction, setDirection] = useState<SortDirection>('desc');
  const [editing, setEditing] = useState<AdminUserView | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<number | null>(null);

  const filters: UserFilters = {
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(role === 'all' ? {} : { role }),
    ...(isActive === 'all' ? {} : { isActive: isActive === 'true' }),
    sort,
    direction,
  };

  const result = useLiveQuery(() => users.listUsers(actor, { ...filters, page, pageSize: 10 }));

  /**
   * Clicking the column already sorted on flips its direction; clicking a different one
   * switches to it in whichever direction that column reads best. Either way the reader goes
   * back to the first page, since page four of the old ordering is not a place they asked
   * to be.
   */
  function changeSort(key: string): void {
    const field = key as UserSortField;
    changeFilter(() => {
      if (field === sort) {
        setDirection((previous) => (previous === 'asc' ? 'desc' : 'asc'));
        return;
      }
      setSort(field);
      setDirection(INITIAL_DIRECTION[field]);
    });
  }

  function changeFilter(apply: () => void): void {
    apply();
    setPage(1);
    setError(null);
    setExported(null);
  }

  /**
   * Exports every account the filters match rather than the ten on screen. The file carries
   * the same projection the table does — no password material passes through the domain's
   * admin view, so there is none here to leak into a spreadsheet.
   */
  function exportMatching(): void {
    setError(null);
    try {
      const matching = users.listAllUsers(actor, filters);

      const csv = toCsv(matching, [
        { header: 'Name', value: (row) => row.displayName },
        { header: 'Email', value: (row) => row.email },
        { header: 'Role', value: (row) => row.role },
        { header: 'Status', value: (row) => (row.isActive ? 'Active' : 'Deactivated') },
        { header: 'Joined', value: (row) => row.createdAt },
        { header: 'Updated', value: (row) => row.updatedAt },
      ]);

      downloadTextFile('users.csv', csv, 'text/csv');
      setExported(matching.length);
    } catch (caught) {
      setExported(null);
      setError(toErrorMessage(caught));
    }
  }

  function handleDelete(id: string): void {
    setError(null);
    try {
      users.deleteUser(actor, id);
      setPendingDelete(null);
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  return (
    <>
      <PageHeader
        title="Users"
        description="Every account on the platform. Updates and deletions are written to the audit log."
        actions={
          <button type="button" className="button" onClick={exportMatching}>
            Export CSV
          </button>
        }
      />

      <Card>
        <Toolbar>
          <Field label="Search">
            <input
              type="search"
              value={search}
              placeholder="Name or email"
              onChange={(event) => changeFilter(() => setSearch(event.target.value))}
            />
          </Field>
          <Field label="Role">
            <select
              value={role}
              onChange={(event) =>
                changeFilter(() => setRole(event.target.value as 'all' | UserRole))
              }
            >
              <option value="all">All roles</option>
              <option value="ADMIN">Admin</option>
              <option value="MEMBER">Member</option>
            </select>
          </Field>
          <Field label="Status">
            <select
              value={isActive}
              onChange={(event) =>
                changeFilter(() => setIsActive(event.target.value as ActiveFilter))
              }
            >
              <option value="all">Any status</option>
              <option value="true">Active</option>
              <option value="false">Deactivated</option>
            </select>
          </Field>
        </Toolbar>

        <ErrorNotice error={error} />

        {exported !== null && (
          <SuccessNotice>
            Exported {exported} {exported === 1 ? 'account' : 'accounts'} to users.csv.
          </SuccessNotice>
        )}

        {result.items.length === 0 ? (
          <EmptyState>No accounts match these filters.</EmptyState>
        ) : (
          <DataTable columns={COLUMNS} sort={{ key: sort, direction, onChange: changeSort }}>
            {result.items.map((user) => (
              <tr key={user.id}>
                <td>{user.displayName}</td>
                <td className="cell--muted">{user.email}</td>
                <td>
                  <Badge tone={user.role === 'ADMIN' ? 'accent' : 'neutral'}>{user.role}</Badge>
                </td>
                <td>
                  <Badge tone={user.isActive ? 'positive' : 'warning'}>
                    {user.isActive ? 'Active' : 'Deactivated'}
                  </Badge>
                </td>
                <td className="cell--muted">{formatDate(user.createdAt)}</td>
                <td className="cell--actions">
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => {
                      setEditing(user);
                      setError(null);
                    }}
                  >
                    Edit
                  </button>
                  {/* The domain refuses to delete your own account, the mirror of the role and
                      active-flag guards in the edit dialog below — there is no reason to offer
                      a control that only errors. */}
                  {user.id !== actor.id &&
                    (pendingDelete === user.id ? (
                      <>
                        <button
                          type="button"
                          className="button button--danger"
                          onClick={() => handleDelete(user.id)}
                        >
                          Confirm delete
                        </button>
                        <button
                          type="button"
                          className="button button--ghost"
                          onClick={() => setPendingDelete(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() => {
                          setPendingDelete(user.id);
                          setError(null);
                        }}
                      >
                        Delete
                      </button>
                    ))}
                </td>
              </tr>
            ))}
          </DataTable>
        )}

        <Pagination result={result} onPageChange={setPage} />
      </Card>

      {editing && <EditUserDialog user={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function EditUserDialog({
  user,
  onClose,
}: {
  user: AdminUserView;
  onClose: () => void;
}): ReactNode {
  const actor = useActor();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [role, setRole] = useState<UserRole>(user.role);
  const [isActive, setIsActive] = useState(user.isActive);
  const [error, setError] = useState<string | null>(null);

  const isSelf = user.id === actor.id;

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    setError(null);

    // Send only what actually changed. Submitting every field would make renaming your own
    // account look like an attempt to change your own role, which the domain refuses, and
    // would fill the audit entry with fields nobody touched.
    const changes: UpdateUserInput = {};
    if (displayName !== user.displayName) changes.displayName = displayName;
    if (role !== user.role) changes.role = role;
    if (isActive !== user.isActive) changes.isActive = isActive;

    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }

    try {
      users.updateUser(actor, user.id, changes);
      onClose();
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  return (
    <Modal title={`Edit ${user.displayName}`} onClose={onClose}>
      <form className="form" onSubmit={handleSubmit}>
        <Field label="Display name">
          <input
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
          />
        </Field>
        <Field label="Platform role" hint={isSelf ? 'You cannot change your own role.' : undefined}>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as UserRole)}
            disabled={isSelf}
          >
            <option value="ADMIN">Admin</option>
            <option value="MEMBER">Member</option>
          </select>
        </Field>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={isActive}
            disabled={isSelf}
            onChange={(event) => setIsActive(event.target.checked)}
          />
          <span>Account is active</span>
        </label>

        <ErrorNotice error={error} />

        <div className="form__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button button--primary">
            Save changes
          </button>
        </div>
      </form>
    </Modal>
  );
}
