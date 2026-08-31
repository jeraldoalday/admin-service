/**
 * Base32, as RFC 4648 defines it.
 *
 * This exists for one reason: a TOTP secret has to be typed into an authenticator app by a
 * human being, or read out of a QR code by one, and base64 is not a alphabet a person can
 * transcribe. Base32's is — no lower case, no digits that look like letters, and a padding
 * character that can be dropped without ambiguity. Every authenticator in circulation
 * expects a shared secret in exactly this encoding, so this is interoperability rather than
 * taste.
 *
 * `0`, `1`, and `8` are absent from the alphabet on purpose, which is what lets the decoder
 * below accept them as the `O`, `I`, and `B` somebody almost certainly meant.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** The characters people substitute when reading a secret off a screen and typing it back. */
const CONFUSABLES: Readonly<Record<string, string>> = Object.freeze({
  '0': 'O',
  '1': 'I',
  '8': 'B',
});

export class Base32Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Base32Error';
  }
}

/**
 * Encodes bytes as base32, padded to a multiple of eight characters.
 *
 * The bytes are fed into a bit accumulator five at a time rather than being chunked into
 * groups of five bytes, which is the same algorithm written in a way that has no special
 * case for the last group: whatever is left in the accumulator at the end is shifted up into
 * a final character, and the padding is arithmetic rather than a table.
 */
export function encodeBase32(bytes: Uint8Array): string {
  let output = '';
  let accumulator = 0;
  let bits = 0;

  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += ALPHABET[(accumulator >>> bits) & 0b11111];
    }
  }

  if (bits > 0) {
    output += ALPHABET[(accumulator << (5 - bits)) & 0b11111];
  }

  // A base32 group is 40 bits — eight characters — and the padding says how much of the last
  // group is real. It is stripped again by every reader here, but a secret exported without
  // it is a secret some authenticators refuse.
  while (output.length % 8 !== 0) {
    output += '=';
  }
  return output;
}

/**
 * Decodes base32 back to bytes, forgiving the things a person typing one in gets wrong.
 *
 * Case is folded, spaces and the hyphens people insert every four characters are dropped,
 * padding is optional, and the three confusable digits are read as the letters they were
 * mistaken for. What is *not* forgiven is a character that could mean two different things,
 * which is why an unknown one is an error rather than a silent skip: a secret that decodes
 * to almost the right bytes produces codes that are wrong for reasons nobody can debug.
 */
export function decodeBase32(input: string): Uint8Array {
  const cleaned = input.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();

  const bytes: number[] = [];
  let accumulator = 0;
  let bits = 0;

  for (const character of cleaned) {
    const resolved = CONFUSABLES[character] ?? character;
    const value = ALPHABET.indexOf(resolved);
    if (value < 0) {
      throw new Base32Error(`"${character}" is not a base32 character`);
    }

    accumulator = (accumulator << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >>> bits) & 0xff);
    }
  }

  // Whatever is left over is the encoder's own padding bits, and they are required to be
  // zero. Non-zero leftovers mean the string was truncated mid-character, and a truncated
  // secret is the failure worth naming rather than rounding off.
  if (bits > 0 && (accumulator & ((1 << bits) - 1)) !== 0) {
    throw new Base32Error('The secret is incomplete');
  }

  return Uint8Array.from(bytes);
}

/**
 * A base32 secret of a given byte length, drawn from the platform's random source.
 *
 * Twenty bytes is the length RFC 4226 names for an HOTP key and the length every
 * authenticator handles without complaint. It is generated as bytes and encoded, rather than
 * by picking characters out of the alphabet: picking characters is how a "random" secret
 * quietly ends up with less entropy than its length suggests.
 */
export function randomBase32Secret(byteLength = 20): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return encodeBase32(bytes);
}

/** Breaks a secret into readable groups, for the screen that asks somebody to type it. */
export function groupBase32(secret: string, size = 4): string {
  return (secret.match(new RegExp(`.{1,${size}}`, 'g')) ?? []).join(' ');
}
