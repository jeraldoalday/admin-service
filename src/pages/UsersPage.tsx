import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
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
  TriStateCheckbox,
} from '@/components/ui';
import {
  lockout,
  toErrorMessage,
  twoFactor,
  users,
  type AdminUserView,
  type SortDirection,
  type UpdateUserInput,
  type UserFilters,
  type UserRole,
  type UserSortField,
} from '@/domain';
import { BulkActionBar } from '@/pages/users/BulkActionBar';
import { ImportUsersDialog } from '@/pages/users/ImportUsersDialog';
import { downloadTextFile, toCsv } from '@/lib/csv';
import { formatDate, formatDateTime } from '@/lib/format';

type ActiveFilter = 'all' | 'true' | 'false';
type LockFilter = 'all' | 'true' | 'false';
type TwoFactorFilter = 'all' | 'true' | 'false';

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
  { label: 'Two-step' },
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
  const [isLocked, setIsLocked] = useState<LockFilter>('all');
  const [hasTwoFactor, setHasTwoFactor] = useState<TwoFactorFilter>('all');
  const [sort, setSort] = useState<UserSortField>('createdAt');
  const [direction, setDirection] = useState<SortDirection>('desc');
  const [editing, setEditing] = useState<AdminUserView | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [resetTwoFactor, setResetTwoFactor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  const filters: UserFilters = {
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(role === 'all' ? {} : { role }),
    ...(isActive === 'all' ? {} : { isActive: isActive === 'true' }),
    ...(isLocked === 'all' ? {} : { isLocked: isLocked === 'true' }),
    ...(hasTwoFactor === 'all' ? {} : { hasTwoFactor: hasTwoFactor === 'true' }),
    sort,
    direction,
  };

  const result = useLiveQuery(() => users.listUsers(actor, { ...filters, page, pageSize: 10 }));

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const pageIds = result.items.map((user) => user.id);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPageSelected = pageIds.some((id) => selected.has(id));

  function toggleOne(id: string): void {
    setSelectedIds((previous) =>
      previous.includes(id) ? previous.filter((candidate) => candidate !== id) : [...previous, id],
    );
  }

  /**
   * The header checkbox covers the page in front of the reader rather than every account the
   * filters match. Selecting rows nobody has seen is how a bulk delete goes wrong, and the
   * page is the only set the screen can actually show while it is being acted on. Selections
   * do carry across pages, so a reader can gather a batch from several of them; the bar
   * always says how many are held.
   */
  function togglePage(): void {
    setSelectedIds((previous) =>
      allOnPageSelected
        ? previous.filter((id) => !pageIds.includes(id))
        : [...new Set([...previous, ...pageIds])],
    );
  }

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

  /**
   * Any change to the filters clears the selection. A held selection survives paging, since
   * that is the same list seen a screen at a time — but narrowing the filters changes which
   * accounts the list is about, and carrying a batch across that boundary would leave the
   * reader holding accounts the screen can no longer show them.
   */
  function changeFilter(apply: () => void): void {
    apply();
    setPage(1);
    setError(null);
    setExported(null);
    setSelectedIds([]);
    setResetTwoFactor(null);
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
        { header: 'Locked until', value: (row) => row.lockedUntil ?? '' },
        { header: 'Two-step', value: (row) => (row.hasTwoFactor ? 'On' : 'Off') },
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

  /**
   * Opens a locked account back up before its lock lapses on its own. This is the "it was
   * me, I mistyped it five times" case: without it the account holder loses a quarter of an
   * hour of work to a mistake everybody involved already understands.
   */
  function handleUnlock(id: string): void {
    setError(null);
    try {
      lockout.unlockAccount(actor, id);
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  /**
   * Takes an authenticator off an account whose owner can no longer reach it — the lost
   * phone with the recovery codes in the same bag. It has to exist: the alternative is an
   * account nobody on the platform can open. The domain writes an entry naming the
   * administrator who did it, and the account holder sees it gone on their own screen, which
   * is what keeps a quiet reset from being possible.
   */
  function handleResetTwoFactor(id: string): void {
    setError(null);
    try {
      twoFactor.disableTwoFactorForUser(actor, id);
      setResetTwoFactor(null);
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  function handleDelete(id: string): void {
    setError(null);
    try {
      users.deleteUser(actor, id);
      setPendingDelete(null);
      // The row's own Delete has to reach the selection too. A selection carries across
      // pages, so an id deleted from underneath it stays held and invisible: the bar goes on
      // counting an account that no longer exists, and the next batch reports it as "User not
      // found" — an error about something the reader never asked for.
      setSelectedIds((previous) => previous.filter((candidate) => candidate !== id));
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  return (
    <>
      <PageHeader
        title="Users"
        description="Every account on the platform. Updates, unlocks, and deletions are written to the audit log."
        actions={
          <>
            <button type="button" className="button" onClick={() => setImporting(true)}>
              Import CSV
            </button>
            <button type="button" className="button" onClick={exportMatching}>
              Export CSV
            </button>
          </>
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
          <Field label="Sign-in">
            <select
              value={isLocked}
              onChange={(event) =>
                changeFilter(() => setIsLocked(event.target.value as LockFilter))
              }
            >
              <option value="all">Any</option>
              <option value="true">Locked out</option>
              <option value="false">Not locked</option>
            </select>
          </Field>
          <Field label="Two-step">
            <select
              value={hasTwoFactor}
              onChange={(event) =>
                changeFilter(() => setHasTwoFactor(event.target.value as TwoFactorFilter))
              }
            >
              <option value="all">Any</option>
              <option value="true">Set up</option>
              <option value="false">Password only</option>
            </select>
          </Field>
        </Toolbar>

        <ErrorNotice error={error} />

        {exported !== null && (
          <SuccessNotice>
            Exported {exported} {exported === 1 ? 'account' : 'accounts'} to users.csv.
          </SuccessNotice>
        )}

        <BulkActionBar
          selectedIds={selectedIds}
          onClear={() => setSelectedIds([])}
          onApplied={() => {
            setSelectedIds([]);
            // Two results side by side, one of them describing a file downloaded several
            // actions ago, read as one report about what just happened.
            setExported(null);
          }}
        />

        {result.items.length === 0 ? (
          <EmptyState>No accounts match these filters.</EmptyState>
        ) : (
          <DataTable
            columns={[
              {
                label: 'Select',
                header: (
                  <TriStateCheckbox
                    checked={allOnPageSelected}
                    indeterminate={someOnPageSelected}
                    label="Select every account on this page"
                    onChange={togglePage}
                  />
                ),
              },
              ...COLUMNS,
            ]}
            sort={{ key: sort, direction, onChange: changeSort }}
          >
            {result.items.map((user) => (
              <tr key={user.id} className={selected.has(user.id) ? 'is-selected' : undefined}>
                <td className="cell--select">
                  <input
                    type="checkbox"
                    checked={selected.has(user.id)}
                    aria-label={`Select ${user.displayName}`}
                    onChange={() => toggleOne(user.id)}
                  />
                </td>
                <td>{user.displayName}</td>
                <td className="cell--muted">{user.email}</td>
                <td>
                  <Badge tone={user.role === 'ADMIN' ? 'accent' : 'neutral'}>{user.role}</Badge>
                </td>
                <td>
                  <Badge tone={user.isActive ? 'positive' : 'warning'}>
                    {user.isActive ? 'Active' : 'Deactivated'}
                  </Badge>
                  {user.isLocked && (
                    <>
                      {' '}
                      <Badge tone="danger">Locked</Badge>
                      <span className="cell--tag">until {formatDateTime(user.lockedUntil)}</span>
                    </>
                  )}
                </td>
                <td>
                  <Badge tone={user.hasTwoFactor ? 'positive' : 'neutral'}>
                    {user.hasTwoFactor ? 'On' : 'Off'}
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
                  {user.isLocked && (
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => handleUnlock(user.id)}
                    >
                      Unlock
                    </button>
                  )}
                  {user.hasTwoFactor &&
                    (resetTwoFactor === user.id ? (
                      <>
                        <button
                          type="button"
                          className="button button--danger"
                          onClick={() => handleResetTwoFactor(user.id)}
                        >
                          Confirm reset
                        </button>
                        <button
                          type="button"
                          className="button button--ghost"
                          onClick={() => setResetTwoFactor(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() => {
                          setResetTwoFactor(user.id);
                          setError(null);
                        }}
                      >
                        Reset two-step
                      </button>
                    ))}
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
      {importing && <ImportUsersDialog onClose={() => setImporting(false)} />}
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
