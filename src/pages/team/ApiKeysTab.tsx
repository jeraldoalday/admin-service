import { useState, type FormEvent, type ReactNode } from 'react';
import { useActor } from '@/app/sessionContext';
import { useLiveQuery } from '@/app/store';
import { DataTable, Pagination } from '@/components/DataTable';
import {
  Badge,
  EmptyState,
  ErrorNotice,
  Field,
  FieldGroup,
  SuccessNotice,
  Toolbar,
} from '@/components/ui';
import {
  API_KEY_STATUSES,
  apiKeys as apiKeysApi,
  permissions as permissionsApi,
  service,
  TEAM_PERMISSIONS,
  toErrorMessage,
  type ApiKeyStatus,
  type TeamPermission,
} from '@/domain';
import {
  expiryUrgency,
  formatDate,
  formatDateTime,
  humanizePermission,
  relativeExpiry,
} from '@/lib/format';

const STATUS_TONES = {
  ACTIVE: 'positive',
  EXPIRED: 'warning',
  REVOKED: 'danger',
} as const satisfies Record<ApiKeyStatus, 'positive' | 'warning' | 'danger'>;

export function ApiKeysTab({ teamId }: { teamId: string }): ReactNode {
  const actor = useActor();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<'all' | ApiKeyStatus>('all');
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<TeamPermission[]>([]);
  const [expiresAt, setExpiresAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [issuedSecret, setIssuedSecret] = useState<{ label: string; secret: string } | null>(null);

  const result = useLiveQuery(() =>
    apiKeysApi.listApiKeys(actor, teamId, {
      page,
      pageSize: 10,
      ...(status === 'all' ? {} : { status }),
    }),
  );
  // The domain refuses to scope a key with a permission the caller does not hold
  // themselves (see createApiKey), so offering it here would only round-trip as an error —
  // the same reasoning the permissions dialog on the members tab already applies to grants.
  const own = useLiveQuery(() => permissionsApi.getOwnPermissions(actor, teamId));
  const ownPermissions = new Set(own.effectivePermissions);

  // Only live keys are worth warning about: a revoked or already-expired key has nothing
  // left to lose by the date passing.
  const expiringSoon = result.items.filter(
    (key) => key.status === 'ACTIVE' && expiryUrgency(key.expiresAt) === 'soon',
  );

  function toggleScope(permission: TeamPermission, checked: boolean): void {
    setScopes((previous) =>
      checked ? [...previous, permission] : previous.filter((item) => item !== permission),
    );
  }

  function handleCreate(event: FormEvent): void {
    event.preventDefault();
    setError(null);
    try {
      const created = apiKeysApi.createApiKey(actor, teamId, {
        name,
        permissions: scopes,
        // Passed as the bare date the picker gives us — the schema widens it to the end of the
        // day it names, so picking today does not read as already expired.
        ...(expiresAt ? { expiresAt } : {}),
      });
      setIssuedSecret({ label: `Key "${created.apiKey.name}" created`, secret: created.secret });
      setName('');
      setScopes([]);
      setExpiresAt('');
      setPage(1);
    } catch (caught) {
      setIssuedSecret(null);
      setError(toErrorMessage(caught));
    }
  }

  function revoke(keyId: string): void {
    setError(null);
    try {
      apiKeysApi.revokeApiKey(actor, teamId, keyId);
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  function rotate(keyId: string): void {
    setError(null);
    try {
      const rotated = apiKeysApi.rotateApiKey(actor, teamId, keyId);
      setIssuedSecret({
        label: `Key "${rotated.apiKey.name}" rotated — the previous secret no longer works`,
        secret: rotated.secret,
      });
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  return (
    <>
      <form className="form" onSubmit={handleCreate}>
        <div className="form__row">
          <Field label="Key name">
            <input
              type="text"
              value={name}
              placeholder="e.g. ci-pipeline"
              onChange={(event) => setName(event.target.value)}
              required
            />
          </Field>
          <Field label="Expires" hint="Optional. Leave empty for a key that never expires.">
            <input
              type="date"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </Field>
        </div>

        <FieldGroup
          label="Scopes"
          hint="You can only scope a key with permissions you hold yourself."
        >
          <div className="permission-grid">
            {TEAM_PERMISSIONS.map((permission) => {
              const beyondActor = !ownPermissions.has(permission);
              return (
                <label key={permission} className="checkbox">
                  <input
                    type="checkbox"
                    checked={scopes.includes(permission)}
                    disabled={beyondActor}
                    onChange={(event) => toggleScope(permission, event.target.checked)}
                  />
                  <span>
                    {humanizePermission(permission)}
                    {beyondActor && <span className="cell--tag">not held</span>}
                  </span>
                </label>
              );
            })}
          </div>
        </FieldGroup>

        <div className="form__actions">
          <button type="submit" className="button button--primary">
            Create key
          </button>
        </div>
      </form>

      <ErrorNotice error={error} />

      {issuedSecret && (
        <SuccessNotice>
          {issuedSecret.label}. Copy the secret now — it is shown once and only its hash is stored:{' '}
          <code className="secret">{issuedSecret.secret}</code>
        </SuccessNotice>
      )}

      <Toolbar>
        <Field label="Status">
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as 'all' | ApiKeyStatus);
              setPage(1);
            }}
          >
            <option value="all">All statuses</option>
            {API_KEY_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </Field>
      </Toolbar>

      {expiringSoon.length > 0 && (
        <p className="notice notice--warning" role="status">
          {expiringSoon.length === 1
            ? `Key "${expiringSoon[0]?.name}" expires ${relativeExpiry(expiringSoon[0]?.expiresAt ?? null)}.`
            : `${expiringSoon.length} keys on this page expire within the next week.`}{' '}
          Rotate before the expiry to hand the caller a new secret without a gap.
        </p>
      )}

      {result.items.length === 0 ? (
        <EmptyState>This team has no API keys.</EmptyState>
      ) : (
        <DataTable columns={['Name', 'Key', 'Scopes', 'Status', 'Expires', 'Last used', '']}>
          {result.items.map((key) => (
            <tr key={key.id}>
              <td>{key.name}</td>
              <td className="cell--muted">
                <code>{key.keyPrefix}…</code>
              </td>
              <td className="cell--muted">
                {key.permissions.length === 0
                  ? 'none'
                  : key.permissions.map(humanizePermission).join(', ')}
              </td>
              <td>
                <Badge tone={STATUS_TONES[key.status]}>{key.status}</Badge>
              </td>
              <td
                className={
                  expiryUrgency(key.expiresAt) === 'soon' && key.status === 'ACTIVE'
                    ? 'cell--warning'
                    : 'cell--muted'
                }
              >
                {key.expiresAt
                  ? `${formatDate(key.expiresAt)} (${relativeExpiry(key.expiresAt)})`
                  : 'never'}
              </td>
              <td className="cell--muted">{formatDateTime(key.lastUsedAt)}</td>
              <td className="cell--actions">
                {key.status === 'ACTIVE' && (
                  <>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => rotate(key.id)}
                    >
                      Rotate
                    </button>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => revoke(key.id)}
                    >
                      Revoke
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
      )}

      <Pagination result={result} onPageChange={setPage} />

      <ServiceCallTester teamId={teamId} />
    </>
  );
}

/**
 * Exercises a key the way another service would. This is the one place a secret is accepted
 * rather than issued, and it makes the guarantees visible: a revoked key, an out-of-scope key,
 * or a key minted for a different team all fail here with the reason spelled out.
 */
function ServiceCallTester({ teamId }: { teamId: string }): ReactNode {
  const [secret, setSecret] = useState('');
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    try {
      const members = service.serviceListTeamMembers(secret, teamId, { pageSize: 100 });
      setOutcome({
        ok: true,
        message: `Authenticated. The key read ${members.total} member${members.total === 1 ? '' : 's'}.`,
      });
    } catch (caught) {
      setOutcome({ ok: false, message: toErrorMessage(caught) });
    }
  }

  return (
    <div className="service-tester">
      <h3>Try a key</h3>
      <p className="card__description">
        Machine clients read this team through a key-authenticated endpoint that requires the{' '}
        <code>MANAGE_MEMBERS</code> scope. Paste a secret to see what it can do.
      </p>
      <form className="form form--inline" onSubmit={handleSubmit}>
        <Field label="API key secret">
          <input
            type="text"
            value={secret}
            placeholder="sk_…"
            onChange={(event) => setSecret(event.target.value)}
            required
          />
        </Field>
        <button type="submit" className="button">
          Send request
        </button>
      </form>
      {outcome && (
        <p
          className={`notice notice--${outcome.ok ? 'success' : 'error'}`}
          role={outcome.ok ? 'status' : 'alert'}
        >
          {outcome.message}
        </p>
      )}
    </div>
  );
}
