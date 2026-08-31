import { useState, type FormEvent, type ReactNode } from 'react';
import { useActor } from '@/app/sessionContext';
import { useLiveQuery } from '@/app/store';
import { Badge, Card, ErrorNotice, Field, SuccessNotice } from '@/components/ui';
import {
  toErrorMessage,
  twoFactor,
  type TwoFactorEnrolmentView,
  type TwoFactorStatus,
} from '@/domain';
import { downloadTextFile } from '@/lib/csv';
import { formatDateTime } from '@/lib/format';

const STATUS_TONE: Record<TwoFactorStatus, 'positive' | 'neutral' | 'warning'> = {
  ENABLED: 'positive',
  PENDING: 'warning',
  DISABLED: 'neutral',
};

const STATUS_LABEL: Record<TwoFactorStatus, string> = {
  ENABLED: 'On',
  PENDING: 'Half set up',
  DISABLED: 'Off',
};

/**
 * Two-step verification, from the account holder's side.
 *
 * The screen is built around the two moments that actually go wrong. The first is the gap
 * between scanning a secret and proving a code works, which is why nothing is enforced until
 * the confirmation succeeds and why an abandoned enrolment is shown as half-finished rather
 * than hidden. The second is the recovery codes: they are readable exactly once, so the
 * screen refuses to move on quietly from the panel that shows them.
 */
export function TwoFactorCard(): ReactNode {
  const actor = useActor();
  const state = useLiveQuery(() => twoFactor.getTwoFactor(actor));

  const [enrolment, setEnrolment] = useState<TwoFactorEnrolmentView | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function begin(): void {
    setError(null);
    setRecoveryCodes(null);
    try {
      setEnrolment(twoFactor.beginTwoFactorEnrolment(actor));
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  }

  return (
    <Card
      title="Two-step verification"
      description="A code from your phone, on top of your password."
      actions={<Badge tone={STATUS_TONE[state.status]}>{STATUS_LABEL[state.status]}</Badge>}
    >
      <ErrorNotice error={error} />

      {recoveryCodes ? (
        <RecoveryCodePanel codes={recoveryCodes} onDone={() => setRecoveryCodes(null)} />
      ) : enrolment ? (
        <EnrolmentPanel
          enrolment={enrolment}
          onConfirmed={(codes) => {
            setEnrolment(null);
            setRecoveryCodes(codes);
          }}
          onCancel={() => setEnrolment(null)}
        />
      ) : state.status === 'ENABLED' ? (
        <EnabledPanel
          confirmedAt={state.confirmedAt}
          remaining={state.remainingRecoveryCodes}
          total={state.totalRecoveryCodes}
          onCodes={setRecoveryCodes}
          onError={setError}
        />
      ) : (
        <>
          <p className="card__description">
            {state.status === 'PENDING'
              ? 'You started setting this up but never confirmed a code, so your password is still all that is needed. Start again to finish it.'
              : 'Your password is currently the only thing protecting this account. A password that has been reused somewhere else is the way accounts like this one are actually taken, and a second step is the answer to exactly that.'}
          </p>
          <div className="form__actions">
            <button type="button" className="button button--primary" onClick={begin}>
              {state.status === 'PENDING' ? 'Start again' : 'Set up two-step verification'}
            </button>
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * The panel that hands over the secret and takes the first code.
 *
 * There is no QR code here, and that is a considered omission rather than an oversight: a QR
 * encoder is several hundred lines of error-correction tables that would have to be right,
 * and the manual secret is the path every authenticator supports anyway. The `otpauth://`
 * link covers the common case of setting this up on the phone itself, where a camera is no
 * use because the screen and the camera are the same device.
 */
function EnrolmentPanel({
  enrolment,
  onConfirmed,
  onCancel,
}: {
  enrolment: TwoFactorEnrolmentView;
  onConfirmed: (codes: string[]) => void;
  onCancel: () => void;
}): ReactNode {
  const actor = useActor();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    setError(null);
    try {
      onConfirmed(twoFactor.confirmTwoFactorEnrolment(actor, { code }).recoveryCodes);
    } catch (caught) {
      setError(toErrorMessage(caught));
      setCode('');
    }
  }

  return (
    <>
      <ol className="list">
        <li className="list__row">
          <span className="list__primary">1. Add this account to your authenticator</span>
          <span className="list__meta">
            Type the key below into the app, or{' '}
            <a href={enrolment.otpauthUri}>open it in an authenticator on this device</a>.
          </span>
        </li>
        <li className="list__row">
          <span className="list__primary">Setup key</span>
          <code className="secret">{enrolment.formattedSecret}</code>
        </li>
        <li className="list__row">
          <span className="list__primary">2. Enter the code it shows</span>
          <span className="list__meta">
            The code changes every thirty seconds. A code from either side of the change is
            accepted, so you do not have to race it.
          </span>
        </li>
      </ol>

      <form className="form" onSubmit={handleSubmit}>
        <Field label="Code from your authenticator">
          <input
            type="text"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="one-time-code"
            inputMode="numeric"
            required
          />
        </Field>

        <ErrorNotice error={error} />

        <div className="form__actions">
          <button type="submit" className="button button--primary">
            Confirm and turn on
          </button>
          <button type="button" className="button button--ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </>
  );
}

/**
 * The one and only sight of the recovery codes.
 *
 * Dismissing it takes a deliberate click on a button that says what dismissing means. The
 * codes are digests from here on, so a panel that closed on a stray click or on the next
 * re-render would be the console losing something on somebody's behalf that it cannot get
 * back.
 */
function RecoveryCodePanel({ codes, onDone }: { codes: string[]; onDone: () => void }): ReactNode {
  return (
    <>
      <SuccessNotice>
        Two-step verification is on. Save these recovery codes somewhere safe — this is the only
        time they can be shown.
      </SuccessNotice>

      <ul className="recovery-codes">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>

      <p className="card__description">
        Each code works once, and only in place of a code from your authenticator. They are stored
        as digests, so nobody — including this console — can show them to you again.
      </p>

      <div className="form__actions">
        <button
          type="button"
          className="button"
          onClick={() =>
            downloadTextFile('admin-service-recovery-codes.txt', codes.join('\n'), 'text/plain')
          }
        >
          Download codes
        </button>
        <button type="button" className="button button--primary" onClick={onDone}>
          I have saved these
        </button>
      </div>
    </>
  );
}

function EnabledPanel({
  confirmedAt,
  remaining,
  total,
  onCodes,
  onError,
}: {
  confirmedAt: string | null;
  remaining: number;
  total: number;
  onCodes: (codes: string[]) => void;
  onError: (message: string | null) => void;
}): ReactNode {
  const actor = useActor();
  const [intent, setIntent] = useState<'regenerate' | 'disable' | null>(null);
  const [password, setPassword] = useState('');
  const [disabled, setDisabled] = useState(false);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    onError(null);
    try {
      if (intent === 'regenerate') {
        onCodes(twoFactor.regenerateRecoveryCodes(actor, { password }).recoveryCodes);
      } else {
        twoFactor.disableTwoFactor(actor, { password });
        setDisabled(true);
      }
      setIntent(null);
      setPassword('');
    } catch (caught) {
      onError(toErrorMessage(caught));
      setPassword('');
    }
  }

  return (
    <>
      {disabled && (
        <SuccessNotice>
          Two-step verification is off, and the recovery codes that went with it no longer work.
        </SuccessNotice>
      )}

      <ul className="list">
        <li className="list__row">
          <span className="list__primary">Turned on</span>
          <span className="list__meta">{formatDateTime(confirmedAt)}</span>
        </li>
        <li className="list__row">
          <span className="list__primary">Recovery codes left</span>
          <span className="list__meta">
            {remaining} of {total}
            {remaining <= 2 && ' — worth generating a new set'}
          </span>
        </li>
      </ul>

      {intent ? (
        <form className="form" onSubmit={handleSubmit}>
          <Field
            label="Your password"
            hint={
              intent === 'disable'
                ? 'Your password rather than a code: what this protects against is somebody using a session you left open.'
                : 'The codes you have now will stop working.'
            }
          >
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>

          <div className="form__actions">
            <button
              type="submit"
              className={intent === 'disable' ? 'button button--danger' : 'button button--primary'}
            >
              {intent === 'disable' ? 'Turn off two-step verification' : 'Generate new codes'}
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => {
                setIntent(null);
                setPassword('');
                onError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="form__actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              setIntent('regenerate');
              setDisabled(false);
              onError(null);
            }}
          >
            New recovery codes
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => {
              setIntent('disable');
              setDisabled(false);
              onError(null);
            }}
          >
            Turn off
          </button>
        </div>
      )}
    </>
  );
}
