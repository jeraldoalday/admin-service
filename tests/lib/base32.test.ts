import { describe, expect, it } from 'vitest';
import {
  Base32Error,
  decodeBase32,
  encodeBase32,
  groupBase32,
  randomBase32Secret,
} from '@/lib/base32';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const text = (encoded: Uint8Array): string => new TextDecoder().decode(encoded);

/**
 * The published RFC 4648 test vectors. Every authenticator app in circulation reads a secret
 * in this encoding, so agreeing with the specification here is what makes an enrolment work
 * on a device this suite cannot see.
 */
describe('encodeBase32', () => {
  it.each([
    ['', ''],
    ['f', 'MY======'],
    ['fo', 'MZXQ===='],
    ['foo', 'MZXW6==='],
    ['foob', 'MZXW6YQ='],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI======'],
  ])('encodes %j as the RFC vector', (input, expected) => {
    expect(encodeBase32(bytes(input))).toBe(expected);
  });

  it('pads to a whole group of eight characters', () => {
    for (let length = 0; length < 12; length += 1) {
      expect(encodeBase32(new Uint8Array(length)).length % 8).toBe(0);
    }
  });
});

describe('decodeBase32', () => {
  it.each([
    ['MY======', 'f'],
    ['MZXQ====', 'fo'],
    ['MZXW6YTBOI======', 'foobar'],
  ])('decodes %j back', (input, expected) => {
    expect(text(decodeBase32(input))).toBe(expected);
  });

  it('round-trips arbitrary bytes', () => {
    for (let length = 0; length <= 40; length += 1) {
      const source = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) % 256);
      expect([...decodeBase32(encodeBase32(source))]).toEqual([...source]);
    }
  });

  it('forgives the ways a person transcribes one', () => {
    const expected = [...decodeBase32('MZXW6YTBOI======')];

    // Lower case, the spacing an enrolment screen prints, hyphens, and no padding at all.
    expect([...decodeBase32('mzxw6ytboi')]).toEqual(expected);
    expect([...decodeBase32('MZXW 6YTB OI')]).toEqual(expected);
    expect([...decodeBase32('MZXW-6YTB-OI')]).toEqual(expected);
  });

  it('reads the digits nobody can tell apart from letters', () => {
    // 0/1/8 are absent from the alphabet, which is exactly what makes reading them as
    // O/I/B unambiguous rather than a guess.
    expect([...decodeBase32('MZXW6YT0')]).toEqual([...decodeBase32('MZXW6YTO')]);
    expect([...decodeBase32('1B8Q1B8Q')]).toEqual([...decodeBase32('IBBQIBBQ')]);
  });

  it('refuses a character that could mean two things', () => {
    expect(() => decodeBase32('MZXW6YT!')).toThrow(Base32Error);
    expect(() => decodeBase32('MZXW6YT!')).toThrow('"!" is not a base32 character');
  });

  it('refuses a secret truncated mid-character', () => {
    // "MA" carries leftover bits that are not zero, which only happens when the string was
    // cut short — a silently rounded-off secret would produce codes nobody could debug.
    expect(() => decodeBase32('MB')).toThrow('The secret is incomplete');
  });
});

describe('randomBase32Secret', () => {
  it('produces a secret of the requested length, decodable back', () => {
    const secret = randomBase32Secret();
    expect(decodeBase32(secret)).toHaveLength(20);
  });

  it('does not produce the same secret twice', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => randomBase32Secret()));
    expect(secrets.size).toBe(50);
  });
});

describe('groupBase32', () => {
  it('breaks a secret up for somebody typing it in', () => {
    expect(groupBase32('MZXW6YTBOI')).toBe('MZXW 6YTB OI');
  });
});
