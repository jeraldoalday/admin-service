import { useState, type FormEvent, type ReactNode } from 'react';
import { useActor } from '@/app/sessionContext';
import { useLiveQuery } from '@/app/store';
import { DataTable, Pagination } from '@/components/DataTable';
import { PageHeader } from '@/components/Layout';
import { Badge, Card, EmptyState, ErrorNotice, Field, Modal, Toolbar } from '@/components/ui';
import {
  toErrorMessage,
  users,
  type AdminUserView,
  type UpdateUserInput,
  type UserRole,
} from '@/domain';
import { formatDate } from '@/lib/format';

type ActiveFilter = 'all' | 'true' | 'false';

/** Admin-only account management: search, filter, edit, and delete platform accounts. */
export function UsersPage(): ReactNode {
  const actor = useActor();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<'all' | UserRole>('all');
  const [isActive, setIsActive] = useState<ActiveFilter>('all');
  const [editing, setEditing] = useState<AdminUserView | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const result = useLiveQuery(() =>
    users.listUsers(actor, {
      page,
      pageSize: 10,
      ...(search.trim() ? { search: search.trim() } : {}),
      ...(role === 'all' ? {} : { role }),
      ...(isActive === 'all' ? {} : { isActive: isActive === 'true' }),
    }),
  );

  function changeFilter(apply: () => void): void {
    apply();
    setPage(1);
    setError(null);
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

        {result.items.length === 0 ? (
          <EmptyState>No accounts match these filters.</EmptyState>
        ) : (
          <DataTable columns={['Name', 'Email', 'Role', 'Status', 'Joined', '']}>
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
                  {pendingDelete === user.id ? (
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
                  )}
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
