import type { TeamPermission } from '@/domain';

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return dateFormatter.format(new Date(iso));
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return dateTimeFormatter.format(new Date(iso));
}

/** "MANAGE_API_KEYS" reads as "Manage api keys" in a checkbox list. */
export function humanizePermission(permission: TeamPermission): string {
  const words = permission.toLowerCase().split('_');
  const [first, ...rest] = words;
  if (!first) return permission;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

/** How close an expiry is, as a tone a badge can wear. */
export type ExpiryUrgency = 'never' | 'distant' | 'soon' | 'passed';

/** A week's notice is the point at which an upcoming expiry is worth flagging on screen. */
export const EXPIRY_WARNING_MS = 7 * 24 * 60 * 60 * 1000;

export function expiryUrgency(iso: string | null): ExpiryUrgency {
  if (!iso) return 'never';
  const deltaMs = Date.parse(iso) - Date.now();
  if (deltaMs <= 0) return 'passed';
  return deltaMs <= EXPIRY_WARNING_MS ? 'soon' : 'distant';
}

export function relativeExpiry(iso: string | null): string {
  if (!iso) return 'never';
  const deltaMs = Date.parse(iso) - Date.now();
  if (deltaMs <= 0) return 'expired';
  const days = Math.ceil(deltaMs / (24 * 60 * 60 * 1000));
  return days === 1 ? 'in 1 day' : `in ${days} days`;
}
