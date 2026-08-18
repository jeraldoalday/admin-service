let counter = 0;

function randomBytesHex(length: number): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Collision-resistant, sortable-ish id in the spirit of the cuid values Prisma generated:
 * a timestamp, a per-session counter, and randomness.
 */
export function createId(): string {
  counter = (counter + 1) % 0xffffff;
  return `c${Date.now().toString(36)}${counter.toString(36).padStart(4, '0')}${randomBytesHex(6)}`;
}

/** Opaque token for invite links and API key secrets. */
export function createToken(byteLength = 24): string {
  return randomBytesHex(byteLength);
}

export function nowIso(): string {
  return new Date().toISOString();
}
