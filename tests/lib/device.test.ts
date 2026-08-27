import { describe, expect, it } from 'vitest';
import { UNKNOWN_DEVICE, describeUserAgent } from '@/lib/device';

/**
 * Real user-agent strings, because the whole difficulty here is that they lie: Chrome claims
 * to be Safari, Edge claims to be Chrome, and every one of them claims to be Mozilla. A rule
 * set that reads well against invented strings tells you nothing about that.
 */
const AGENTS: [string, string][] = [
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Chrome on macOS',
  ],
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'Safari on macOS',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
    'Firefox on Windows',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
    'Edge on Windows',
  ],
  [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
    'Safari on iOS',
  ],
  [
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    'Chrome on Android',
  ],
  [
    'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
    'Samsung Internet on Android',
  ],
  [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OPR/117.0.0.0',
    'Opera on Linux',
  ],
];

describe('describing the browser a session was opened from', () => {
  it.each(AGENTS)('reads %#: %s', (userAgent, expected) => {
    expect(describeUserAgent(userAgent)).toBe(expected);
  });

  it('names whichever half it can recognise', () => {
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0)')).toBe('Windows');
    expect(describeUserAgent('Firefox/1.0')).toBe('Firefox');
  });

  it('falls back to a placeholder rather than to the raw string', () => {
    expect(describeUserAgent('')).toBe(UNKNOWN_DEVICE);
    expect(describeUserAgent('curl/8.4.0')).toBe(UNKNOWN_DEVICE);
  });
});
