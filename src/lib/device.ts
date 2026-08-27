/**
 * A short, human-readable name for the browser a session was started from.
 *
 * The point of the name is recognition, not forensics: somebody scanning their list of
 * signed-in devices is looking for the one that is not theirs, and "Firefox on Windows" when
 * they have only ever used Safari on a Mac answers that question instantly, where a full
 * user-agent string answers it eventually. Anything unrecognised falls back to a neutral
 * placeholder rather than to the raw string, which would be neither shorter nor clearer.
 */

interface Rule {
  label: string;
  test: RegExp;
}

/**
 * Order matters throughout, because user-agent strings are cumulative fiction: Chrome claims
 * to be Safari, Edge claims to be Chrome, and every one of them claims to be Mozilla. The
 * most specific claim has to be checked first or it is never reached.
 */
const BROWSERS: Rule[] = [
  { label: 'Edge', test: /\bEdg[A-Z]?\// },
  { label: 'Opera', test: /\bOPR\// },
  { label: 'Samsung Internet', test: /\bSamsungBrowser\// },
  { label: 'Firefox', test: /\bFirefox\// },
  { label: 'Chrome', test: /\bChrom(e|ium)\// },
  { label: 'Safari', test: /\bSafari\// },
];

const PLATFORMS: Rule[] = [
  { label: 'iOS', test: /\b(iPhone|iPad|iPod)\b/ },
  { label: 'Android', test: /\bAndroid\b/ },
  { label: 'Windows', test: /\bWindows\b/ },
  { label: 'macOS', test: /\b(Macintosh|Mac OS X)\b/ },
  { label: 'Linux', test: /\b(Linux|X11)\b/ },
];

function match(rules: Rule[], userAgent: string): string | null {
  return rules.find((rule) => rule.test.test(userAgent))?.label ?? null;
}

export const UNKNOWN_DEVICE = 'Unknown device';

export function describeUserAgent(userAgent: string): string {
  const browser = match(BROWSERS, userAgent);
  const platform = match(PLATFORMS, userAgent);

  if (browser && platform) return `${browser} on ${platform}`;
  return browser ?? platform ?? UNKNOWN_DEVICE;
}

/** The current browser's description, for labelling a session as it is opened. */
export function describeDevice(): string {
  try {
    return describeUserAgent(globalThis.navigator?.userAgent ?? '');
  } catch {
    // A non-DOM environment has no navigator to ask, and a session with an unrecognised
    // label is still perfectly usable.
    return UNKNOWN_DEVICE;
  }
}
