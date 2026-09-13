import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useActor } from '@/app/sessionContext';
import { useLiveQuery, useLiveResult } from '@/app/store';
import { PageHeader } from '@/components/Layout';
import { Badge, Card, ErrorNotice, Field } from '@/components/ui';
import {
  permissions as permissionsApi,
  teams,
  toErrorMessage,
  type TeamPermission,
} from '@/domain';
import { formatDate } from '@/lib/format';
import { ActivityTab } from './ActivityTab';
import { ApiKeysTab } from './ApiKeysTab';
import { InvitesTab } from './InvitesTab';
import { MembersTab, OwnPermissionsSummary } from './MembersTab';

const TABS = ['Members', 'Invites', 'API keys', 'Activity', 'Settings'] as const;
type Tab = (typeof TABS)[number];

/**
 * One team, with the tabs a member is actually allowed to open. Tabs are filtered by the
 * caller's effective permissions rather than rendered-and-disabled, so the navigation itself
 * reflects what the domain would allow.
 */
export function TeamDetailPage(): ReactNode {
  const actor = useActor();
  const { teamId = '' } = useParams();
  const [tab, setTab] = useState<Tab>('Members');

  const team = useLiveResult(() => teams.getTeam(actor, teamId));
  const own = useLiveQuery(() => {
    try {
      return permissionsApi.getOwnPermissions(actor, teamId);
    } catch {
      return null;
    }
  });

  if (team.error || !team.data) {
    return (
      <>
        <PageHeader title="Team" />
        <Card>
          <ErrorNotice error={team.error?.message ?? 'Team not found'} />
          <p>
            <Link to="/teams">Back to your teams</Link>
          </p>
        </Card>
      </>
    );
  }

  const can = (permission: TeamPermission): boolean =>
    own?.effectivePermissions.includes(permission) ?? false;

  const visibleTabs = TABS.filter((candidate) => {
    if (candidate === 'Invites') return can('MANAGE_INVITES');
    if (candidate === 'API keys') return can('MANAGE_API_KEYS');
    if (candidate === 'Activity') return can('MANAGE_TEAM');
    return true;
  });
  const activeTab = visibleTabs.includes(tab) ? tab : 'Members';

  return (
    <>
      <PageHeader
        title={team.data.name}
        description={
          <>
            <code>{team.data.slug}</code> · created {formatDate(team.data.createdAt)}
          </>
        }
        actions={
          <Badge tone={team.data.role === 'MEMBER' ? 'neutral' : 'accent'}>{team.data.role}</Badge>
        }
      />

      <nav className="tabs" aria-label="Team sections">
        {visibleTabs.map((candidate) => (
          <button
            key={candidate}
            type="button"
            className={`tabs__tab${candidate === activeTab ? ' is-active' : ''}`}
            aria-current={candidate === activeTab ? 'page' : undefined}
            onClick={() => setTab(candidate)}
          >
            {candidate}
          </button>
        ))}
      </nav>

      <Card>
        {activeTab === 'Members' && (
          <MembersTab
            teamId={teamId}
            canManageMembers={can('MANAGE_MEMBERS')}
            canManagePermissions={can('MANAGE_PERMISSIONS')}
            isOwner={team.data.role === 'OWNER'}
          />
        )}
        {activeTab === 'Invites' && <InvitesTab teamId={teamId} />}
        {activeTab === 'API keys' && <ApiKeysTab teamId={teamId} />}
        {activeTab === 'Activity' && <ActivityTab teamId={teamId} />}
        {activeTab === 'Settings' && (
          <TeamSettings
            teamId={teamId}
            name={team.data.name}
            isOwner={team.data.role === 'OWNER'}
            canManageTeam={can('MANAGE_TEAM')}
          />
        )}
      </Card>
    </>
  );
}

function TeamSettings({
  teamId,
  name,
  isOwner,
  canManageTeam,
}: {
  teamId: string;
  name: string;
  isOwner: boolean;
  canManageTeam: boolean;
}): ReactNode {
  const actor = useActor();
  const navigate = useNavigate();
  const [draftName, setDraftName] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  function handleRename(event: FormEvent): void {
    event.preventDefault();
    setError(null);
    try {
      teams.updateTeam(actor, teamId, { name: draftName });
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  function handleLeave(): void {
    setError(null);
    try {
      teams.leaveTeam(actor, teamId);
      navigate('/teams');
    } catch (caught) {
      setConfirmingLeave(false);
      setError(toErrorMessage(caught));
    }
  }

  function handleDelete(): void {
    setError(null);
    try {
      teams.deleteTeam(actor, teamId);
      navigate('/teams');
    } catch (caught) {
      setConfirmingDelete(false);
      setError(toErrorMessage(caught));
    }
  }

  return (
    <div className="settings">
      <OwnPermissionsSummary teamId={teamId} />

      {canManageTeam && (
        <form className="form form--inline" onSubmit={handleRename}>
          <Field label="Team name">
            <input
              type="text"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              required
            />
          </Field>
          <button type="submit" className="button button--primary">
            Rename team
          </button>
        </form>
      )}

      <ErrorNotice error={error} />

      <div className="settings__danger">
        <div>
          <h3>Leave this team</h3>
          <p className="card__description">
            A team always needs an owner, so the last owner has to hand over or delete it first.
          </p>
          {confirmingLeave ? (
            <div className="cell--actions">
              <button type="button" className="button button--danger" onClick={handleLeave}>
                Confirm leave
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setConfirmingLeave(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="button" onClick={() => setConfirmingLeave(true)}>
              Leave team
            </button>
          )}
        </div>

        {isOwner && (
          <div>
            <h3>Delete this team</h3>
            <p className="card__description">
              Removes the team along with its memberships, invites, grants, and API keys.
              Owner-only, and deliberately outside the grantable permission set.
            </p>
            {confirmingDelete ? (
              <div className="cell--actions">
                <button type="button" className="button button--danger" onClick={handleDelete}>
                  Confirm delete
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => setConfirmingDelete(false)}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="button button--danger"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete team
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
