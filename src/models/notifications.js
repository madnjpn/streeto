import { all, count, get, run } from '../db.js';

/**
 * Lightweight notification feed. Rows are written by the routes when
 * something interesting happens (friend request, comment, invite...).
 */
export function notify({ userId, actorId = null, type, entityId = null, url = null, text }) {
  if (!userId || (actorId && actorId === userId)) return null;
  const info = run(
    `INSERT INTO notifications (user_id, actor_id, type, entity_id, url, text)
     VALUES (?, ?, ?, ?, ?, ?)`,
    userId,
    actorId,
    type,
    entityId,
    url,
    text,
  );
  return info.lastInsertRowid;
}

export const recent = (userId, limit = 40) =>
  all(
    `SELECT n.*, u.username AS actor_username, u.display_name AS actor_display_name, u.avatar AS actor_avatar
       FROM notifications n
       LEFT JOIN users u ON u.id = n.actor_id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT ?`,
    userId,
    limit,
  );

export const unreadCount = (userId) =>
  count('notifications', 'user_id = ? AND read_at IS NULL', userId);

export function markAllRead(userId) {
  run(
    `UPDATE notifications
        SET read_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE user_id = ? AND read_at IS NULL`,
    userId,
  );
}

export const clearAll = (userId) => run('DELETE FROM notifications WHERE user_id = ?', userId);

/** Avoid stacking duplicates for the same target (e.g. repeated likes). */
export const alreadyNotified = ({ userId, actorId, type, entityId }) =>
  Boolean(
    get(
      `SELECT 1 AS x FROM notifications
        WHERE user_id = ? AND actor_id = ? AND type = ? AND entity_id = ?`,
      userId,
      actorId,
      type,
      entityId,
    ),
  );

/**
 * Tell every admin about something that needs their attention - a claim
 * waiting for a decision, for example. The admin then finds it in the
 * console instead of having to go and look for it.
 */
export function notifyAdmins({ actorId = null, type, entityId = null, url = null, text, except = [] }) {
  const admins = all('SELECT id FROM users WHERE is_admin = 1').map((row) => row.id);
  let sent = 0;
  for (const id of admins) {
    if (except.includes(id)) continue;
    if (notify({ userId: id, actorId, type, entityId, url, text })) sent += 1;
  }
  return sent;
}

export default { notify, notifyAdmins, recent, unreadCount, markAllRead, clearAll, alreadyNotified };
