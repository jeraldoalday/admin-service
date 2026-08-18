import bcrypt from 'bcryptjs';

/**
 * Cost factor. The service used bcrypt's default of 10; 8 keeps sign-in responsive when the
 * hashing runs on the UI thread instead of a server, at a cost that is still far past
 * anything a browser-side demo needs.
 */
const SALT_ROUNDS = 8;

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, SALT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}
