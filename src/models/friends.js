import { all, get, run } from '../db.js';

/** Every accepted friend of a user. */
export const friends = (userId) =>
  all(
    `SELECT u.id, u.username, u.display_name, u.avatar, u.car, u.city,
            f.updated_at AS friends_since
       FROM friendships f
       JOIN users u
         ON u.id = CASE WHEN f.requester_id = :me THEN f.addressee_id ELSE f.requester_id END
      WHERE f.status = 'accepted' AND (f.requester_id = :me OR f.addressee_id = :me)
      ORDER BY u.username COLLATE NOCASE`,
    { me: userId },
  );

/** Requests waiting for me to accept or decline. */
export const incomingRequests = (userId) =>
  all(
    `SELECT f.id, f.created_at, u.id AS user_id, u.username, u.display_name, u.avatar, u.car, u.city
       FROM friendships f JOIN users u ON u.id = f.requester_id
      WHERE f.addressee_id = :me AND f.status = 'pending'
      ORDER BY f.created_at DESC`,
    { me: userId },
  );

/** Requests I sent that are still unanswered. */
export const outgoingRequests = (userId) =>
  all(
    `SELECT f.id, f.created_at, u.id AS user_id, u.username, u.display_name, u.avatar
       FROM friendships f JOIN users u ON u.id = f.addressee_id
      WHERE f.requester_id = :me AND f.status = 'pending'
      ORDER BY f.created_at DESC`,
    { me: userId },
  );

/** The single row connecting two users, in either direction. */
export const stateOf = (a, b) =>
  get(
    `SELECT * FROM friendships
      WHERE (requester_id = :a AND addressee_id = :b)
         OR (requester_id = :b AND addressee_id = :a)`,
    { a, b },
  );

export const areFriends = (a, b) => stateOf(a, b)?.status === 'accepted';

export const friendIds = (userId) =>
  all(
    `SELECT CASE WHEN requester_id = :me THEN addressee_id ELSE requester_id END AS id
       FROM friendships
      WHERE status = 'accepted' AND (requester_id = :me OR addressee_id = :me)`,
    { me: userId },
  ).map((row) => row.id);

export const friendCount = (userId) =>
  get(
    `SELECT COUNT(*) AS n FROM friendships
      WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`,
    userId,
    userId,
  ).n;

/**
 * Describe the relationship between two users in a template-friendly
 * shape: { status: null|'pending'|'accepted'|'declined', direction:
 * 'outgoing'|'incoming'|null, id }.
 */
export function relationship(a, b) {
  const row = stateOf(a, b);
  if (!row) return { status: null, direction: null, id: null };
  const direction =
    row.status === 'pending' || row.status === 'blocked'
      ? row.requester_id === a
        ? 'outgoing'
        : 'incoming'
      : null;
  return { status: row.status, direction, id: row.id, row };
}

/** Send (or resend after a decline) a friend request. */
export function sendRequest(fromId, toId) {
  if (fromId === toId) return { ok: false, error: 'You cannot add yourself.' };

  const existing = stateOf(fromId, toId);
  if (existing) {
    if (existing.status === 'accepted') return { ok: false, error: 'You are already friends.' };
    if (existing.status === 'blocked') return { ok: false, error: 'That request cannot be sent.' };
    if (existing.status === 'pending') {
      if (existing.requester_id === fromId) return { ok: false, error: 'Request already sent.' };
      // They already asked us - accept instead of creating a second row.
      run(
        `UPDATE friendships SET status = 'accepted', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE id = ?`,
        existing.id,
      );
      return { ok: true, accepted: true, id: existing.id };
    }
    // declined -> let the requester try again
    run(
      `UPDATE friendships
          SET requester_id = ?, addressee_id = ?, status = 'pending',
              created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE id = ?`,
      fromId,
      toId,
      existing.id,
    );
    return { ok: true, accepted: false, id: existing.id };
  }

  const info = run('INSERT INTO friendships (requester_id, addressee_id) VALUES (?, ?)', fromId, toId);
  return { ok: true, accepted: false, id: info.lastInsertRowid };
}

/** Accept a request that was addressed to `userId`. */
export function acceptRequest(requestId, userId) {
  const row = get('SELECT * FROM friendships WHERE id = ?', requestId);
  if (!row || row.addressee_id !== userId || row.status !== 'pending') return null;
  run(
    `UPDATE friendships SET status = 'accepted', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`,
    requestId,
  );
  return get('SELECT * FROM friendships WHERE id = ?', requestId);
}

export function declineRequest(requestId, userId) {
  const row = get('SELECT * FROM friendships WHERE id = ?', requestId);
  if (!row || row.addressee_id !== userId || row.status !== 'pending') return false;
  run(
    `UPDATE friendships SET status = 'declined', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`,
    requestId,
  );
  return true;
}

/** Cancel my own pending request. */
export function cancelRequest(requestId, userId) {
  const row = get('SELECT * FROM friendships WHERE id = ?', requestId);
  if (!row || row.requester_id !== userId || row.status !== 'pending') return false;
  run('DELETE FROM friendships WHERE id = ?', requestId);
  return true;
}

/** Unfriend (either side may do it). */
export function removeFriend(otherId, userId) {
  const row = stateOf(userId, otherId);
  if (!row || row.status !== 'accepted') return false;
  run('DELETE FROM friendships WHERE id = ?', row.id);
  return true;
}

/** Friends of my friends - used for the "mutual" hint on profiles. */
export function mutualCount(a, b) {
  const mine = new Set(friendIds(a));
  return friendIds(b).filter((id) => mine.has(id)).length;
}

export default {
  friends, incomingRequests, outgoingRequests, stateOf, areFriends, friendIds, friendCount,
  relationship, sendRequest, acceptRequest, declineRequest, cancelRequest, removeFriend, mutualCount,
};
