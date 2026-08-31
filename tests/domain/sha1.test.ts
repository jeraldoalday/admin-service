import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hmacSha1, sha1Bytes, sha1Hex } from '@/domain/sha1';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const hex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * A one-time password is HMAC-SHA-1 of a counter, so an implementation that is subtly wrong
 * produces codes that are consistently wrong — and from the outside that looks exactly like
 * somebody typing them in badly. Checking against `node:crypto` is what rules that out.
 */
describe('sha1Hex', () => {
  it.each([
    ['', 'da39a3ee5e6b4b0d3255bfef95601890afd80709'],
    ['abc', 'a9993e364706816aba3e25717850c26c9cd0d89d'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '84983e441c3bd26ebaae4aa1f95129e5e54670f1',
    ],
  ])('hashes %j to the published vector', (input, expected) => {
    expect(sha1Hex(bytes(input))).toBe(expected);
  });

  it('agrees with node:crypto across the padding boundary', () => {
    // 55 and 56 bytes sit either side of the point where the length no longer fits in the
    // final block, which is where a hand-written padding step goes wrong if it is going to.
    const inputs = ['', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), 'héllo'];

    inputs.forEach((input) => {
      expect(sha1Hex(bytes(input))).toBe(createHash('sha1').update(input, 'utf8').digest('hex'));
    });
  });

  it('returns twenty bytes', () => {
    expect(sha1Bytes(bytes('anything'))).toHaveLength(20);
  });
});

describe('hmacSha1', () => {
  it('matches the RFC 2202 vector', () => {
    expect(hex(hmacSha1(new Uint8Array(20).fill(0x0b), bytes('Hi There')))).toBe(
      'b617318655057264e28bc0b6fb378c8ef146be00',
    );
  });

  it('agrees with node:crypto for keys either side of the block size', () => {
    // 63, 64, and 65 bytes: padded, exact, and hashed-down. The last is the case that
    // silently breaks if a long key is truncated instead of hashed.
    [1, 20, 63, 64, 65, 200].forEach((keyLength) => {
      const key = Uint8Array.from({ length: keyLength }, (_, index) => (index * 31) % 256);
      const message = bytes('the message being authenticated');

      expect(hex(hmacSha1(key, message))).toBe(
        createHmac('sha1', Buffer.from(key)).update(Buffer.from(message)).digest('hex'),
      );
    });
  });
});
