import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

// scrypt is memory-hard and, unlike bcrypt/argon2, needs no native
// module - it ships with Node's crypto. Parameters are stored inside
// the hash string so they can be raised later without breaking
// existing accounts.
const PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };
const PREFIX = 'scrypt';

/** Hash a plaintext password into a self-describing string. */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password.normalize('NFKC'), salt, PARAMS.keylen, {
    N: PARAMS.N,
    r: PARAMS.r,
    p: PARAMS.p,
    maxmem: 256 * 1024 * 1024,
  });
  return [
    PREFIX,
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/** Constant-time password check. Never throws on malformed hashes. */
export async function verifyPassword(password, stored) {
  try {
    if (typeof stored !== 'string') return false;
    const [prefix, N, r, p, saltB64, hashB64] = stored.split('$');
    if (prefix !== PREFIX) return false;

    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const derived = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 256 * 1024 * 1024,
    });

    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** Random URL-safe token, used for CSRF tokens. */
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
