import { useEffect, useState, type ReactNode } from 'react';
import { DEMO_RECOVERY_CODES, DEMO_TOTP_SECRET, DEMO_TWO_FACTOR_EMAIL, totp } from '@/domain';

/**
 * The demo's way past its own second step.
 *
 * Two-step verification is the one feature in this console that cannot be explored by
 * clicking: the second half of it lives on a device the reader does not have. Printing the
 * code the seeded authenticator is showing right now closes that gap without weakening
 * anything — the secret is a published fixture, sitting in the seed file next to the shared
 * password, and it means somebody can watch the whole flow work rather than take it on
 * trust.
 *
 * The countdown is not decoration either: it is the clearest way to show that a code has a
 * life of about thirty seconds, which is the single fact somebody needs in order to
 * understand why the console accepts a code from either side of the boundary.
 */
export function DemoTwoFactorHint(): ReactNode {
  const [now, setNow] = useState(() => Date.now());

  // A tick a second, and only on the sign-in screen. The code it prints changes on a clock
  // rather than on a store mutation, so nothing else in the console would ever re-render it.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const secondsLeft =
    totp.TOTP_PERIOD_SECONDS - (Math.floor(now / 1000) % totp.TOTP_PERIOD_SECONDS);

  return (
    <p>
      <code>{DEMO_TWO_FACTOR_EMAIL}</code> has two-step verification turned on. Its authenticator is
      showing <code>{totp.currentCode(DEMO_TOTP_SECRET, now)}</code> for another {secondsLeft}s, and{' '}
      <code>{DEMO_RECOVERY_CODES[1]}</code> is one of its unused recovery codes.
    </p>
  );
}
