import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSession } from '@/app/sessionContext';
import { ErrorNotice, Field } from '@/components/ui';
import { toErrorMessage, type SignInResult } from '@/domain';

type Challenge = Extract<SignInResult, { kind: 'TWO_FACTOR_REQUIRED' }>;

/**
 * The second half of a sign-in.
 *
 * It deliberately says nothing about the account it belongs to — no email, no name. The
 * challenge is handed out on a correct password, so a screen that named the account would
 * turn a guessed password into a way of confirming whose it was, which is the enumeration
 * the sign-in form spends its whole design refusing to do.
 *
 * The same box takes a six-digit code and a recovery code, because the person in front of it
 * has one field and knows which of the two they are holding. Making them pick a mode first
 * would be asking somebody whose phone has just gone missing to classify their own problem.
 */
export function TwoFactorStep({
  challenge,
  onCancel,
}: {
  challenge: Challenge;
  onCancel: () => void;
}): ReactNode {
  const { completeTwoFactor } = useSession();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(() => Date.parse(challenge.expiresAt) <= Date.now());

  /**
   * The challenge lapses on a clock rather than on a click, so the screen has to notice on
   * its own. Without this, somebody who walked away comes back, types a code they read
   * correctly off their phone, and is told it is wrong — when what actually happened is that
   * the console stopped waiting several minutes ago.
   */
  useEffect(() => {
    // A challenge that had already lapsed before this mounted is caught by the initial
    // state above, so there is nothing to set here — only a timer for the one that lapses
    // while somebody is looking at it.
    const remaining = Date.parse(challenge.expiresAt) - Date.now();
    if (remaining <= 0) return;

    const timer = setTimeout(() => setExpired(true), remaining);
    return () => clearTimeout(timer);
  }, [challenge.expiresAt]);

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    setError(null);
    try {
      completeTwoFactor(challenge.challengeId, code);
    } catch (caught) {
      setError(toErrorMessage(caught));
      setCode('');
    }
  }

  return (
    <>
      <h1>Two-step verification</h1>
      <p className="auth__lede">
        Enter the six-digit code from your authenticator app. If you cannot reach it, one of the
        recovery codes you saved will do instead.
      </p>

      {expired ? (
        <>
          <p className="notice notice--warning" role="status">
            This sign-in has timed out. Enter your password again to start over.
          </p>
          <button type="button" className="button button--primary button--block" onClick={onCancel}>
            Back to sign in
          </button>
        </>
      ) : (
        <form onSubmit={handleSubmit} className="form">
          <Field label="Authentication code" hint="Six digits, or a recovery code.">
            <input
              type="text"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              // `one-time-code` is what lets a phone offer the code straight from the
              // notification, which is the difference between this step being a formality and
              // being the reason somebody turns two-step verification off again.
              autoComplete="one-time-code"
              inputMode="text"
              autoFocus
              required
            />
          </Field>

          <ErrorNotice error={error} />

          <button type="submit" className="button button--primary button--block">
            Verify
          </button>

          <p className="auth__switch">
            <button type="button" className="link" onClick={onCancel}>
              Use a different account
            </button>
          </p>
        </form>
      )}
    </>
  );
}
