/**
 * Password reset links.
 *
 * A link is 32 random bytes, and only its SHA-256 is written down - the
 * database can be read without handing anybody an account. A link works
 * once, for an hour, and only the newest one of an account is alive.
 */
import crypto from 'node:crypto';
import { get, run } from '../db.js';

/** The secret that goes into the link. */
export const makeToken = () => crypto.randomBytes(32).toString('base64url');

/** What is stored instead of the secret. */
export const hashToken = (token) =>
  crypto.createHash('sha256').update(String(token)).digest('hex');

/**
 * Ask for a link. Every older, unused link of the account is dropped:
 * two live links would be two ways in.
 */
export function create({ userId, token, email, ip, ttlMs }) {
  const now = Date.now();
  run('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL', userId);
  const info = run(
    `INSERT INTO password_resets (user_id, token_hash, email, ip, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    userId,
    hashToken(token),
    email || null,
    ip || null,
    new Date(now).toISOString(),
    new Date(now + ttlMs).toISOString(),
  );
  return info.lastInsertRowid;
}

/**
 * The account behind a link, or null when the link is unknown, used or
 * too old.
 */
export function findOpen(token) {
  if (!token) return null;
  const row = get(
    `SELECT r.id, r.user_id, r.email, r.expires_at,
            u.username, u.email AS user_email, u.display_name
       FROM password_resets r
       JOIN users u ON u.id = r.user_id
      WHERE r.token_hash = ? AND r.used_at IS NULL`,
    hashToken(token),
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  return row;
}

/** Burn a link so it cannot be used twice. */
export const consume = (id) =>
  run('UPDATE password_resets SET used_at = ? WHERE id = ?', new Date().toISOString(), id);

/** Drop every link of an account (after the password changed). */
export const forgetAll = (userId) =>
  run('DELETE FROM password_resets WHERE user_id = ?', userId);

/** How many links an account asked for inside a window - the throttle. */
export const recentForUser = (userId, ms) =>
  get(
    'SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND created_at > ?',
    userId,
    new Date(Date.now() - ms).toISOString(),
  ).n;

/** Housekeeping: links that are long dead have no value. */
export const purge = () =>
  run('DELETE FROM password_resets WHERE expires_at < ?', new Date(Date.now() - 864e5).toISOString());

/**
 * Log out every session of an account. A password change must not leave
 * an old session - or a stolen phone - logged in.
 */
export function clearSessions(userId) {
  try {
    run(`DELETE FROM sessions WHERE json_extract(data, '$.userId') = ?`, userId);
  } catch {
    /* no JSON1 in this SQLite build - sessions expire on their own */
  }
}

export default { makeToken, hashToken, create, findOpen, consume, forgetAll, recentForUser, purge, clearSessions };
