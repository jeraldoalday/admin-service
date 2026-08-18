import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '@/domain/sha256';

/**
 * The API key store looks keys up by digest, so this implementation has to agree with the
 * `node:crypto` one the service used. These are the published FIPS 180-4 vectors.
 */
describe('sha256Hex', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
  ])('hashes %j', (input, expected) => {
    expect(sha256Hex(input)).toBe(expected);
  });

  it('handles input long enough to span multiple blocks', () => {
    expect(sha256Hex('a'.repeat(1000))).toBe(
      '41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3',
    );
  });

  it('agrees with node:crypto, the implementation it replaces', () => {
    const inputs = ['héllo', 'sk_' + 'ab'.repeat(24), '🔑 key', 'a'.repeat(55), 'a'.repeat(56)];

    inputs.forEach((input) => {
      expect(sha256Hex(input)).toBe(createHash('sha256').update(input, 'utf8').digest('hex'));
    });
  });
});
