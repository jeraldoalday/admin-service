import { useState, type FormEvent, type ReactNode } from 'react';
import { useActor, useSession } from '@/app/sessionContext';
import { useLiveQuery } from '@/app/store';
import { PageHeader } from '@/components/Layout';
import { Badge, Card, ErrorNotice, Field, SuccessNotice } from '@/components/ui';
import { auth, teams, toErrorMessage } from '@/domain';
import { formatDate } from '@/lib/format';
import { SessionsCard } from './account/SessionsCard';
import { SignInActivityCard } from './account/SignInActivityCard';

/**
 * The screen an account manages itself from. Everything here is self-service: renaming,
 * changing a password, and ending sessions are the writes an account may make to itself, and
 * the domain enforces that independently — the role and the active flag stay on the
 * admin-only users screen, where changing them is somebody else's decision to make.
 *
 * The security half of the screen is deliberately the account holder's rather than an
 * administrator's. A leaked password shows up as failures its owner knows they did not make,
 * and a stolen session shows up as a device they do not recognise; in both cases the person
 * best placed to notice is the one whose account it is, and they can act on it here without
 * having to ask anybody.
 */
export function AccountPage(): ReactNode {
  const { user } = useSession();
  const actor = useActor();
  const teamCount = useLiveQuery(() => teams.listTeamsForUser(actor, { pageSize: 1 }).total);

  if (!user) return null;

  return (
    <>
      <PageHeader
        title="Account"
        description="Your name, your password, and the devices signed in as you."
        actions={<Badge tone={user.role === 'ADMIN' ? 'accent' : 'neutral'}>{user.role}</Badge>}
      />

      <Card title="Details">
        <ul className="list">
          <li className="list__row">
            <span className="list__primary">Email</span>
            <span className="list__meta">{user.email}</span>
          </li>
          <li className="list__row">
            <span className="list__primary">Platform role</span>
            <span className="list__meta">
              {user.role === 'ADMIN'
                ? 'Admin — user management and the audit log are available to you'
                : 'Member — team screens are scoped to the teams you belong to'}
            </span>
          </li>
          <li className="list__row">
            <span className="list__primary">Teams</span>
            <span className="list__meta">
              {teamCount} {teamCount === 1 ? 'team' : 'teams'}
            </span>
          </li>
          <li className="list__row">
            <span className="list__primary">Joined</span>
            <span className="list__meta">{formatDate(user.createdAt)}</span>
          </li>
        </ul>
      </Card>

      <ProfileForm displayName={user.displayName} />
      <PasswordForm />
      <SessionsCard />
      <SignInActivityCard />
    </>
  );
}

function ProfileForm({ displayName }: { displayName: string }): ReactNode {
  const actor = useActor();
  const [draft, setDraft] = useState(displayName);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    setError(null);
    setSaved(false);
    try {
      auth.updateProfile(actor, { displayName: draft });
      setSaved(true);
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  return (
    <Card title="Profile" description="The name shown next to everything you do.">
      <form className="form form--inline" onSubmit={handleSubmit}>
        <Field label="Display name">
          <input
            type="text"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setSaved(false);
            }}
            required
          />
        </Field>
        <button type="submit" className="button button--primary">
          Save name
        </button>
      </form>

      <ErrorNotice error={error} />
      {saved && <SuccessNotice>Your display name has been updated.</SuccessNotice>}
    </Card>
  );
}

function PasswordForm(): ReactNode {
  const actor = useActor();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    setError(null);
    setChanged(false);
    try {
      auth.changePassword(actor, { currentPassword, newPassword, confirmPassword });
      // Nothing typed here is worth keeping around once the change has gone through.
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setChanged(true);
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  return (
    <Card
      title="Password"
      description="Changing it requires the current one, and signs your other devices out."
    >
      <form className="form" onSubmit={handleSubmit}>
        <Field label="Current password">
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
        </Field>
        <Field label="New password" hint="At least 8 characters.">
          <input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
        </Field>
        <Field label="Confirm new password">
          <input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </Field>

        <ErrorNotice error={error} />
        {changed && (
          <SuccessNotice>
            Your password has been changed, and every other device signed out.
          </SuccessNotice>
        )}

        <div className="form__actions">
          <button type="submit" className="button button--primary">
            Change password
          </button>
        </div>
      </form>
    </Card>
  );
}
