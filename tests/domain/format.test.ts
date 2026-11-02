import { describe, expect, it } from 'vitest';
import {
  EXPIRY_WARNING_MS,
  expiryUrgency,
  formatDate,
  formatDateTime,
  humanizePermission,
  relativeExpiry,
} from '@/lib/format';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe('formatDate', () => {
  it('renders a day/month/year date', () => {
    expect(formatDate('2026-03-01T12:00:00.000Z')).toBe('01 Mar 2026');
  });

  it('renders an em dash for a null date', () => {
    expect(formatDate(null)).toBe('—');
  });
});

describe('formatDateTime', () => {
  it('renders a date and time', () => {
    expect(formatDateTime('2026-03-01T13:30:00.000Z')).toContain('2026');
  });

  it('renders an em dash for a null date', () => {
    expect(formatDateTime(null)).toBe('—');
  });
});

describe('humanizePermission', () => {
  it('title-cases the first word and lower-cases the rest', () => {
    expect(humanizePermission('MANAGE_API_KEYS')).toBe('Manage api keys');
  });

  it('handles a permission with no underscore', () => {
    expect(humanizePermission('MANAGE_MEMBERS' as never)).toBe('Manage members');
  });
});

describe('expiryUrgency', () => {
  it('is "never" for no expiry', () => {
    expect(expiryUrgency(null)).toBe('never');
  });

  it('is "passed" once the deadline has gone', () => {
    expect(expiryUrgency(new Date(Date.now() - HOUR_MS).toISOString())).toBe('passed');
  });

  it('is "soon" inside the warning window', () => {
    expect(expiryUrgency(new Date(Date.now() + EXPIRY_WARNING_MS / 2).toISOString())).toBe('soon');
  });

  it('is "distant" outside the warning window', () => {
    expect(expiryUrgency(new Date(Date.now() + EXPIRY_WARNING_MS + HOUR_MS).toISOString())).toBe(
      'distant',
    );
  });
});

describe('relativeExpiry', () => {
  it('reads "never" for no expiry', () => {
    expect(relativeExpiry(null)).toBe('never');
  });

  it('reads "expired" once the deadline has gone', () => {
    expect(relativeExpiry(new Date(Date.now() - HOUR_MS).toISOString())).toBe('expired');
  });

  it('singularises "in 1 day"', () => {
    expect(relativeExpiry(new Date(Date.now() + HOUR_MS).toISOString())).toBe('in 1 day');
  });

  it('pluralises "in N days"', () => {
    expect(relativeExpiry(new Date(Date.now() + 5 * DAY_MS).toISOString())).toBe('in 5 days');
  });
});
