import { useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from '@/app/sessionContext';
import { ErrorNotice, Field } from '@/components/ui';
import {
  DEMO_ADMIN_EMAIL,
  DEMO_PASSWORD,
  lockout,
  toErrorMessage,
  type SignInResult,
} from '@/domain';
import { DemoTwoFactorHint } from './signIn/DemoTwoFactorHint';
import { TwoFactorStep } from './signIn/TwoFactorStep';

type Mode = 'signin' | 'register';

type Challenge = Extract<SignInResult, { kind: 'TWO_FACTOR_REQUIRED' }>;

/** Sign-in and registration, sharing one card because they differ by a single field. */
export function SignInPage(): ReactNode {
  const { user, signIn, register } = useSession();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<Challenge | null>(null);

  if (user) {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from ?? '/'} replace />;
  }

  /**
   * Counts down the attempts left before the address locks.
   *
   * It is safe to say out loud, because the throttle treats an address nobody has registered
   * exactly like one that exists — so the count says how many guesses remain and nothing at
   * all about whether there is an account behind them. What it buys is that somebody who has
   * simply mistyped their password twice finds out before the lock rather than after it.
   */
  function warnAboutRemainingAttempts(address: string): void {
    const lock = lockout.lockStateFor(address);
    setWarning(
      lock.isLocked || lock.failedAttempts === 0
        ? null
        : `${lock.retriesRemaining} more failed ${lock.retriesRemaining === 1 ? 'attempt' : 'attempts'} will lock this address for 15 minutes.`,
    );
  }

  function handleSubmit(event: FormEvent): void {
    event.preventDefault();
    setError(null);
    setWarning(null);
    try {
      if (mode !== 'signin') {
        register(email, password, displayName);
        return;
      }

      const result = signIn(email, password);
      if (result.kind === 'TWO_FACTOR_REQUIRED') {
        // The password is dropped the moment it stops being needed. The second step runs on
        // the challenge alone, and a password sitting in state behind it would be a password
        // sitting in a form somebody may well walk away from.
        setPassword('');
        setChallenge(result);
      }
    } catch (caught) {
      setError(toErrorMessage(caught));
      if (mode === 'signin') warnAboutRemainingAttempts(email);
    }
  }

  /** Abandons a half-finished sign-in and puts the credentials form back. */
  function cancelChallenge(): void {
    setChallenge(null);
    setPassword('');
    setError(null);
    setWarning(null);
  }

  function switchTo(next: Mode): void {
    setMode(next);
    setError(null);
    setWarning(null);
  }

  return (
    <div className="auth">
      <div className="auth__panel">
        <div className="shell__brand">
          <span className="shell__brand-mark">as</span>
          <span>admin-service</span>
        </div>
        {challenge ? (
          <TwoFactorStep challenge={challenge} onCancel={cancelChallenge} />
        ) : (
          renderCredentials()
        )}

        <aside className="auth__demo">
          <p>
            Demo data is seeded on first run. Sign in as <code>{DEMO_ADMIN_EMAIL}</code> with the
            password <code>{DEMO_PASSWORD}</code> — every seeded account shares it.
          </p>
          <DemoTwoFactorHint />
        </aside>
      </div>
    </div>
  );

  /**
   * The credentials half of the card. It is a function returning elements rather than a
   * component: a component declared inside another one is a new type on every render, so
   * React would unmount and remount the whole form after each keystroke and focus would land
   * back on the page. Called as a plain function, the elements simply belong to this render.
   */
  function renderCredentials(): ReactNode {
    return (
      <>
        <h1>{mode === 'signin' ? 'Sign in' : 'Create an account'}</h1>
        <p className="auth__lede">
          The internal admin console for users, teams, permissions, API keys, and the audit trail.
        </p>

        <form onSubmit={handleSubmit} className="form">
          {mode === 'register' && (
            <Field label="Display name">
              <input
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="name"
                required
              />
            </Field>
          )}
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </Field>
          <Field label="Password" hint={mode === 'register' ? 'At least 8 characters.' : undefined}>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
            />
          </Field>

          <ErrorNotice error={error} />
          {warning && (
            <p className="notice notice--warning" role="status">
              {warning}
            </p>
          )}

          <button type="submit" className="button button--primary button--block">
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="auth__switch">
          {mode === 'signin' ? (
            <>
              No account yet?{' '}
              <button type="button" className="link" onClick={() => switchTo('register')}>
                Create one
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button type="button" className="link" onClick={() => switchTo('signin')}>
                Sign in
              </button>
            </>
          )}
        </p>
      </>
    );
  }
}
