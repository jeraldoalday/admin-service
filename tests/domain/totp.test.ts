import { describe, expect, it } from 'vitest';
import {
  TOTP_PERIOD_SECONDS,
  codeForStep,
  currentCode,
  normalizeCode,
  otpauthUri,
  timeStepAt,
  verifyCode,
} from '@/domain/totp';
import { encodeBase32 } from '@/lib/base32';

/** The key RFC 6238 states its vectors against: the ASCII digits 1-0, twice over. */
const RFC_SECRET = encodeBase32(new TextEncoder().encode('12345678901234567890'));
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';

describe('codeForStep', () => {
  /**
   * The published RFC 6238 vectors, truncated to the six digits this console uses. The last
   * one sits past 2^31 seconds, which is where a counter written with bitwise operations
   * silently loses its high bits.
   */
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ])('matches the published vector at T=%d', (seconds, expected) => {
    expect(codeForStep(RFC_SECRET, timeStepAt(seconds * 1000))).toBe(expected);
  });

  it('always produces exactly six digits', () => {
    for (let step = 0; step < 200; step += 1) {
      expect(codeForStep(SECRET, step)).toMatch(/^\d{6}$/);
    }
  });
});

describe('timeStepAt', () => {
  it('holds still for thirty seconds and then moves', () => {
    // Exactly on a window boundary, so "29 seconds later" is unambiguously the same window.
    const base = 1_700_000_010_000;
    const step = timeStepAt(base);

    expect(timeStepAt(base + 29_000)).toBe(step);
    expect(timeStepAt(base + 30_000)).toBe(step + 1);
  });
});

describe('verifyCode', () => {
  const now = 1_700_000_000_000;
  const step = timeStepAt(now);

  it('accepts the code for the present window and says which step it was', () => {
    expect(verifyCode(SECRET, codeForStep(SECRET, step), { now })).toBe(step);
  });

  it('accepts one step either side, for clocks that disagree', () => {
    expect(verifyCode(SECRET, codeForStep(SECRET, step - 1), { now })).toBe(step - 1);
    expect(verifyCode(SECRET, codeForStep(SECRET, step + 1), { now })).toBe(step + 1);
  });

  it('refuses a code from further out than the drift allows', () => {
    expect(verifyCode(SECRET, codeForStep(SECRET, step - 2), { now })).toBeNull();
    expect(verifyCode(SECRET, codeForStep(SECRET, step + 2), { now })).toBeNull();
  });

  it('accepts a code typed with the spacing an app shows it in', () => {
    const code = codeForStep(SECRET, step);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;

    expect(verifyCode(SECRET, spaced, { now })).toBe(step);
  });

  it('refuses anything that is not six digits without hashing it', () => {
    expect(verifyCode(SECRET, '12345', { now })).toBeNull();
    expect(verifyCode(SECRET, '1234567', { now })).toBeNull();
    expect(verifyCode(SECRET, 'abcdef', { now })).toBeNull();
    expect(verifyCode(SECRET, '', { now })).toBeNull();
  });

  it('refuses a code derived from a different secret', () => {
    const other = 'KRSXG5CTMVRXEZLUKRSXG5CTMVRXEZLU';
    expect(verifyCode(SECRET, codeForStep(other, step), { now })).toBeNull();
  });

  it('agrees with what an authenticator would be showing now', () => {
    expect(verifyCode(SECRET, currentCode(SECRET))).not.toBeNull();
  });
});

describe('normalizeCode', () => {
  it('drops the separators people type between groups', () => {
    expect(normalizeCode(' 123-456 ')).toBe('123456');
  });
});

describe('otpauthUri', () => {
  const uri = otpauthUri({ secret: SECRET, account: 'raj@example.com', issuer: 'admin-service' });

  it('names the issuer in the label as well as the parameters', () => {
    // Both, on purpose: older apps read the label and newer ones read the parameter, and an
    // enrolment that satisfies only one shows up as an entry nobody can tell apart.
    expect(uri).toContain(encodeURIComponent('admin-service:raj@example.com'));
    expect(new URL(uri).searchParams.get('issuer')).toBe('admin-service');
  });

  it('spells out the parameters rather than relying on an app defaulting to them', () => {
    const parameters = new URL(uri).searchParams;

    expect(parameters.get('algorithm')).toBe('SHA1');
    expect(parameters.get('digits')).toBe('6');
    expect(parameters.get('period')).toBe(String(TOTP_PERIOD_SECONDS));
  });

  it('carries the secret without its padding', () => {
    const padded = otpauthUri({ secret: 'MY======', account: 'a@b.com', issuer: 'x' });
    expect(new URL(padded).searchParams.get('secret')).toBe('MY');
  });
});
