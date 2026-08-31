/**
 * Minimal synchronous SHA-1 and HMAC-SHA-1.
 *
 * SHA-1 is not here because it is a good hash — it is not, and nothing in this console
 * stores anything under it. It is here because RFC 4226 specifies HMAC-SHA-1 as the
 * function a one-time password is derived with, and every authenticator app somebody
 * already has on their phone implements exactly that. A stronger choice would be a code
 * their app computes differently, which is not a stronger choice at all.
 *
 * HMAC's security rests on the key rather than on collision resistance, which is why the
 * construction survives SHA-1's collision weaknesses and why the specification has not
 * moved. The window is thirty seconds wide and the output is six digits, so the thing worth
 * protecting is the shared secret, and this never handles it in a way that leaks.
 *
 * As with `sha256.ts`, `crypto.subtle` is asynchronous and not implemented by every DOM
 * environment the tests run in, so the algorithm is written out over 32-bit words. It is
 * checked against `node:crypto` directly in the suite, since a hash that is subtly wrong
 * produces codes that are consistently wrong and look, from the outside, like a user typing
 * them in badly.
 */

function rotl(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

/** The SHA-1 digest of a byte string, as twenty bytes. */
export function sha1Bytes(message: Uint8Array): Uint8Array {
  const bitLength = message.length * 8;

  // Pad to a multiple of 64 bytes: 0x80, then zeroes, then the length as a 64-bit
  // big-endian — the same framing SHA-256 uses, since both are Merkle-Damgård.
  const paddedLength = (((message.length + 8) >> 6) + 1) << 6;
  const buffer = new Uint8Array(paddedLength);
  buffer.set(message);
  buffer[message.length] = 0x80;

  const view = new DataView(buffer.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const hash = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
  const w = new Uint32Array(80);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 80; i += 1) {
      w[i] = rotl(
        (w[i - 3] as number) ^ (w[i - 8] as number) ^ (w[i - 14] as number) ^ (w[i - 16] as number),
        1,
      );
    }

    let a = hash[0] as number;
    let b = hash[1] as number;
    let c = hash[2] as number;
    let d = hash[3] as number;
    let e = hash[4] as number;

    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }

      const temp = (rotl(a, 5) + f + e + k + (w[i] as number)) >>> 0;
      e = d;
      d = c;
      c = rotl(b, 30);
      b = a;
      a = temp;
    }

    const round = [a, b, c, d, e];
    for (let i = 0; i < 5; i += 1) {
      hash[i] = ((hash[i] as number) + (round[i] as number)) >>> 0;
    }
  }

  const digest = new Uint8Array(20);
  const digestView = new DataView(digest.buffer);
  for (let i = 0; i < 5; i += 1) {
    digestView.setUint32(i * 4, hash[i] as number, false);
  }
  return digest;
}

export function sha1Hex(message: Uint8Array): string {
  return Array.from(sha1Bytes(message), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** SHA-1's input block, and therefore HMAC's. */
const BLOCK_SIZE = 64;

/**
 * HMAC-SHA-1, as RFC 2104 defines it: the key is brought to one block — hashed first when it
 * is longer than one, zero-padded when it is shorter — then folded through the inner and
 * outer pads.
 *
 * A key longer than a block being hashed rather than truncated is the part worth being
 * careful about. Truncating would make two different secrets that share a prefix produce the
 * same codes, and the secrets here are generated rather than chosen, so nothing else in the
 * system would ever notice.
 */
export function hmacSha1(key: Uint8Array, message: Uint8Array): Uint8Array {
  const blockKey = new Uint8Array(BLOCK_SIZE);
  blockKey.set(key.length > BLOCK_SIZE ? sha1Bytes(key) : key);

  const inner = new Uint8Array(BLOCK_SIZE + message.length);
  const outer = new Uint8Array(BLOCK_SIZE + 20);

  for (let i = 0; i < BLOCK_SIZE; i += 1) {
    inner[i] = (blockKey[i] as number) ^ 0x36;
    outer[i] = (blockKey[i] as number) ^ 0x5c;
  }

  inner.set(message, BLOCK_SIZE);
  outer.set(sha1Bytes(inner), BLOCK_SIZE);
  return sha1Bytes(outer);
}
