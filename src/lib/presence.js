/**
 * Who is online right now.
 *
 * Two signals are combined:
 *
 *  - a socket is open for the member (the chat dock keeps one on every
 *    page), which is instant but depends on the socket handshake,
 *  - the member made a request in the last minute or so, which always
 *    works because it rides on the normal session.
 *
 * The result is a live hint, not a fact worth storing precisely: the
 * database column is only refreshed once a minute per member.
 */
import { all, run } from '../db.js';

/** A member counts as online this long after their last request. */
const ONLINE_WINDOW_MS = 90 * 1000;

/** How often the database timestamp is refreshed for the same member. */
const TOUCH_INTERVAL_MS = 30 * 1000;

/** user id -> how many sockets that member has open. */
const connections = new Map();

/** user id -> when we last wrote the timestamp. */
const lastTouched = new Map();

/** Cached list of online ids, so a page full of cards is one query. */
let cache = { ids: [], at: 0 };

/** A socket connected for this user. */
export function addOnline(userId) {
  if (!userId) return;
  connections.set(userId, (connections.get(userId) || 0) + 1);
  cache = { ids: [], at: 0 };
}

/** A socket closed. The user is offline when the last one goes. */
export function removeOnline(userId) {
  if (!userId) return;
  const count = (connections.get(userId) || 0) - 1;
  if (count > 0) connections.set(userId, count);
  else connections.delete(userId);
  cache = { ids: [], at: 0 };
}

/**
 * Note that the member just made a request. Writes the timestamp at most
 * once a minute per member, so a busy page does not hammer the database.
 */
export function touch(userId) {
  if (!userId) return;
  const now = Date.now();
  if (now - (lastTouched.get(userId) || 0) < TOUCH_INTERVAL_MS) return;
  lastTouched.set(userId, now);
  try {
    run('UPDATE users SET last_seen = ? WHERE id = ?', new Date(now).toISOString(), userId);
  } catch (error) {
    // Presence is cosmetic - never let it break a request.
  }
  cache = { ids: [], at: 0 };
}

/** The ids of everyone who is online, from both signals. */
export function onlineUserIds() {
  if (Date.now() - cache.at < 15_000) return cache.ids;

  const ids = new Set(connections.keys());
  try {
    const since = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
    for (const row of all(
      `SELECT id FROM users WHERE last_seen IS NOT NULL AND last_seen > ?`,
      since,
    )) {
      ids.add(row.id);
    }
  } catch (error) {
    // Fall back to the socket list only.
  }
  cache = { ids: [...ids], at: Date.now() };
  return cache.ids;
}

/** Is this user online at this moment? */
export function isOnline(userId) {
  if (!userId) return false;
  if (connections.has(userId)) return true;
  return onlineUserIds().includes(userId);
}

export default { addOnline, removeOnline, touch, isOnline, onlineUserIds };
