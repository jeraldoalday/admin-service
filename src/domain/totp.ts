import { decodeBase32 } from '@/lib/base32';
import { hmacSha1 } from './sha1';

/**
 * Time-based one-time passwords, as RFC 6238 defines them on top of RFC 4226's HOTP.
 *
 * The parameters below are not choices so much as the values every authenticator app
 * assumes when a QR code does not spell them out: a thirty-second step, six digits, and
 * HMAC-SHA-1. An enrolment that differs from them in any way produces codes that are
 * correct by the specification and rejected by the phone in front of the person enrolling,
 * which is the least debuggable failure this feature could have. They are named here rather
 * than scattered so the otpauth URI and the verifier cannot drift apart.
 */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

/**
 * How many steps either side of the present one are accepted.
 *
 * A phone's clock and a browser's clock disagree by a few seconds far more often than
 * anybody would guess, and somebody who reads a code at the twenty-ninth second of its
 * window will submit it in the next one. One step in each direction covers both without
 * widening the guessing surface much: it is the difference between one live code and three,
 * against a six-digit space, and the sign-in throttle is what actually bounds guessing.
 */
export const TOTP_DRIFT_STEPS = 1;

/** Which thirty-second window an instant falls in. */
export function timeStepAt(now = Date.now(), period = TOTP_PERIOD_SECONDS): number {
  return Math.floor(now / 1000 / period);
}

/**
 * The eight-byte, big-endian counter HOTP hashes.
 *
 * It is written as two 32-bit halves because a step number is comfortably inside the safe
 * integer range but well outside what a bitwise operation can hold — shifting it would
 * silently truncate, and the truncation would only start mattering in the year 2106.
 */
function counterBytes(counter: number): Uint8Array {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, Math.floor(counter / 0x100000000), false);
  view.setUint32(4, counter >>> 0, false);
  return bytes;
}

/**
 * The code for one particular step, given the shared secret.
 *
 * The last nibble of the digest picks where in it to read from — "dynamic truncation" — and
 * the high bit of the four bytes taken is masked off so the result is a positive 31-bit
 * number on every platform, signed or not. That masking is the one step in HOTP everybody
 * gets wrong the first time, and getting it wrong makes roughly half of all codes incorrect.
 */
export function codeForStep(secret: string, counter: number, digits = TOTP_DIGITS): string {
  const digest = hmacSha1(decodeBase32(secret), counterBytes(counter));
  const offset = (digest[digest.length - 1] as number) & 0x0f;

  const binary =
    (((digest[offset] as number) & 0x7f) << 24) |
    ((digest[offset + 1] as number) << 16) |
    ((digest[offset + 2] as number) << 8) |
    (digest[offset + 3] as number);

  return (binary % 10 ** digits).toString().padStart(digits, '0');
}

/**
 * How much longer the code on screen has, for a display that wants to say so.
 *
 * It lives here, next to the period it divides by, rather than beside the caller that needs
 * it: a countdown computed from a hardcoded thirty is a second description of the window,
 * and the two would drift the first time anybody changed the period.
 */
export function secondsUntilNextCode(now = Date.now(), period = TOTP_PERIOD_SECONDS): number {
  return period - (Math.floor(now / 1000) % period);
}

/** The code an authenticator would be showing right now. */
export function currentCode(secret: string, now = Date.now()): string {
  return codeForStep(secret, timeStepAt(now));
}

/**
 * Digits only, with the spaces and hyphens people type between groups removed.
 *
 * A code copied out of an app arrives as "123 456" often enough that rejecting it would be
 * the console blaming somebody for its own pedantry.
 */
export function normalizeCode(input: string): string {
  return input.replace(/[\s-]/g, '');
}

/**
 * Compares two codes without letting the time taken say how much of the first one was right.
 *
 * A six-digit code is not a secret worth a timing attack in any realistic setting, but the
 * habit is worth keeping: this is the same shape of comparison an API key digest deserves,
 * and writing it the careful way once costs nothing.
 */
function codesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

/**
 * Checks a code against the steps around now, and reports *which* step matched.
 *
 * Returning the step rather than a boolean is the whole point. A code stays valid for the
 * length of its window, so a code somebody has already used is a code an onlooker can use
 * again within the same half-minute; the only way to stop that is for the caller to remember
 * the last step it accepted and refuse anything at or before it. A verifier that answered
 * yes or no would leave the caller no way to tell a fresh code from a replayed one.
 */
export function verifyCode(
  secret: string,
  input: string,
  options: { now?: number; drift?: number } = {},
): number | null {
  const code = normalizeCode(input);
  if (!/^\d+$/.test(code) || code.length !== TOTP_DIGITS) return null;

  const drift = options.drift ?? TOTP_DRIFT_STEPS;
  const current = timeStepAt(options.now ?? Date.now());

  // Walked outwards from the present step so the newest match wins, which is what keeps the
  // replay floor moving forward rather than being pinned to an older step by a code that
  // happens to be valid in two windows.
  for (let offset = 0; offset <= drift; offset += 1) {
    for (const step of offset === 0 ? [current] : [current + offset, current - offset]) {
      if (codesMatch(code, codeForStep(secret, step))) return step;
    }
  }
  return null;
}

/**
 * The `otpauth://` URI an authenticator reads out of a QR code.
 *
 * The label carries the issuer as well as the account, joined by a colon, *and* the issuer
 * is repeated as a parameter. That duplication is in Google's key URI format on purpose:
 * older apps read the label, newer ones read the parameter, and an enrolment that only
 * satisfies one of them shows up in somebody's app as an unnamed entry they cannot tell
 * apart from their other unnamed entries.
 */
export function otpauthUri({
  secret,
  account,
  issuer,
}: {
  secret: string;
  account: string;
  issuer: string;
}): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const parameters = new URLSearchParams({
    secret: secret.replace(/=+$/, ''),
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });

  return `otpauth://totp/${label}?${parameters.toString()}`;
}
