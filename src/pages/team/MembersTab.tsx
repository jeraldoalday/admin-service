import { useState, type ReactNode } from 'react';
import { useActor } from '@/app/sessionContext';
import { useLiveQuery } from '@/app/store';
import { DataTable, Pagination } from '@/components/DataTable';
import { Badge, EmptyState, ErrorNotice, FieldGroup, Modal } from '@/components/ui';
import {
  permissions as permissionsApi,
  teams,
  toErrorMessage,
  TEAM_PERMISSIONS,
  type EffectivePermissions,
  type TeamMemberView,
  type TeamPermission,
  type TeamRole,
} from '@/domain';
import { formatDate, humanizePermission } from '@/lib/format';

export function MembersTab({
  teamId,
  canManageMembers,
  canManagePermissions,
  canManageOwnership,
}: {
  teamId: string;
  canManageMembers: boolean;
  canManagePermissions: boolean;
  /** Only an owner may hand out ownership, which the domain enforces independently. */
  canManageOwnership: boolean;
}): ReactNode {
  const actor = useActor();
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const [editingPermissions, setEditingPermissions] = useState<TeamMemberView | null>(null);

  const result = useLiveQuery(() => teams.listTeamMembers(actor, teamId, { page, pageSize: 10 }));

  function changeRole(userId: string, role: TeamRole): void {
    setError(null);
    try {
      teams.updateMemberRole(actor, teamId, userId, role);
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  function removeMember(userId: string): void {
    setError(null);
    try {
      teams.removeMember(actor, teamId, userId);
      setPendingRemoval(null);
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  return (
    <>
      <ErrorNotice error={error} />

      {result.items.length === 0 ? (
        <EmptyState>This team has no members.</EmptyState>
      ) : (
        <DataTable columns={['Member', 'Email', 'Team role', 'Joined', '']}>
          {result.items.map((member) => (
            <tr key={member.userId}>
              <td>
                {member.displayName}
                {member.userId === actor.id && <span className="cell--tag">you</span>}
              </td>
              <td className="cell--muted">{member.email}</td>
              <td>
                {canManageMembers ? (
                  <select
                    aria-label={`Team role for ${member.displayName}`}
                    value={member.role}
                    onChange={(event) => changeRole(member.userId, event.target.value as TeamRole)}
                  >
                    {/*
                      Offered only to an owner. A member who runs the roster can still see
                      that an owner exists — the option they cannot use is simply not on the
                      menu, rather than there to be picked and refused.
                    */}
                    {(canManageOwnership || member.role === 'OWNER') && (
                      <option value="OWNER">OWNER</option>
                    )}
                    <option value="ADMIN">ADMIN</option>
                    <option value="MEMBER">MEMBER</option>
                  </select>
                ) : (
                  <Badge tone={member.role === 'MEMBER' ? 'neutral' : 'accent'}>
                    {member.role}
                  </Badge>
                )}
              </td>
              <td className="cell--muted">{formatDate(member.createdAt)}</td>
              <td className="cell--actions">
                {canManagePermissions && (
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => setEditingPermissions(member)}
                  >
                    Permissions
                  </button>
                )}
                {canManageMembers &&
                  (pendingRemoval === member.userId ? (
                    <>
                      <button
                        type="button"
                        className="button button--danger"
                        onClick={() => removeMember(member.userId)}
                      >
                        Confirm remove
                      </button>
                      <button
                        type="button"
                        className="button button--ghost"
                        onClick={() => setPendingRemoval(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => setPendingRemoval(member.userId)}
                    >
                      Remove
                    </button>
                  ))}
              </td>
            </tr>
          ))}
        </DataTable>
      )}

      <Pagination result={result} onPageChange={setPage} />

      {editingPermissions && (
        <PermissionsDialog
          teamId={teamId}
          member={editingPermissions}
          onClose={() => setEditingPermissions(null)}
        />
      )}
    </>
  );
}

/**
 * Grants extend a member beyond their role's defaults. Permissions their role already carries
 * are shown checked and locked — there is nothing to grant, and nothing a grant could remove.
 */
function PermissionsDialog({
  teamId,
  member,
  onClose,
}: {
  teamId: string;
  member: TeamMemberView;
  onClose: () => void;
}): ReactNode {
  const actor = useActor();
  const current: EffectivePermissions | null = useLiveQuery(() => {
    try {
      return permissionsApi.getEffectivePermissions(actor, teamId, member.userId);
    } catch {
      return null;
    }
  });

  const [selected, setSelected] = useState<TeamPermission[]>(
    () => current?.grantedPermissions ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function toggle(permission: TeamPermission, checked: boolean): void {
    setSaved(false);
    setSelected((previous) =>
      checked ? [...previous, permission] : previous.filter((item) => item !== permission),
    );
  }

  function save(): void {
    setError(null);
    try {
      permissionsApi.setMemberPermissionGrants(actor, teamId, member.userId, selected);
      setSaved(true);
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  const rolePermissions = current?.rolePermissions ?? [];

  return (
    <Modal title={`Permissions for ${member.displayName}`} onClose={onClose}>
      <p className="modal__lede">
        Their team role is <strong>{member.role}</strong>, which carries{' '}
        {rolePermissions.length === 0 ? 'no permissions' : `${rolePermissions.length} permissions`}{' '}
        by default. Grants below are additive.
      </p>

      <div className="permission-grid">
        {TEAM_PERMISSIONS.map((permission) => {
          const fromRole = rolePermissions.includes(permission);
          return (
            <label key={permission} className="checkbox">
              <input
                type="checkbox"
                checked={fromRole || selected.includes(permission)}
                disabled={fromRole}
                onChange={(event) => toggle(permission, event.target.checked)}
              />
              <span>
                {humanizePermission(permission)}
                {fromRole && <span className="cell--tag">from role</span>}
              </span>
            </label>
          );
        })}
      </div>

      <ErrorNotice error={error} />
      {saved && <p className="notice notice--success">Permissions updated.</p>}

      <div className="form__actions">
        <button type="button" className="button button--ghost" onClick={onClose}>
          Close
        </button>
        <button type="button" className="button button--primary" onClick={save}>
          Save grants
        </button>
      </div>
    </Modal>
  );
}

export function OwnPermissionsSummary({ teamId }: { teamId: string }): ReactNode {
  const actor = useActor();
  const own = useLiveQuery(() => permissionsApi.getOwnPermissions(actor, teamId));

  return (
    <FieldGroup label="Your effective permissions">
      <p className="permission-summary">
        {own.effectivePermissions.length === 0
          ? 'None — you can view this team but not change it.'
          : own.effectivePermissions.map(humanizePermission).join(', ')}
      </p>
    </FieldGroup>
  );
}
