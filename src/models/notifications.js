import { all, count, get, run } from '../db.js';
import { pushToUser } from '../lib/push-all.js';
import { translate } from '../lib/i18n.js';
import { NOTIFICATION_CATEGORIES, categoryForType } from '../lib/notification-prefs.js';

/**
 * Lightweight notification feed. Rows are written by the routes when
 * something interesting happens (friend request, comment, invite...).
 */
export function notify({
  userId,
  actorId = null,
  type,
  entityId = null,
  url = null,
  text,
  push = true,
  category = null,
}) {
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
  const id = info.lastInsertRowid;

  // The activity row and the push are one event. Chat messages send their
  // own push (they are not activity rows), and a DM mention opts out here
  // because that message already produced one.
  if (push) {
    try {
      const actor = actorId ? get('SELECT username FROM users WHERE id = ?', actorId) : null;
      const lang = get('SELECT language FROM users WHERE id = ?', userId)?.language || 'en';
      const parts = String(text || '').split('|');
      let vars;
      if (parts.length >= 4 && parts[0].includes('{n}')) {
        vars = { n: parts[1], plural: parts[2], name: parts.slice(3).join('|') };
      } else if (parts.length > 1) {
        vars = { name: parts.slice(1).join('|') };
      }
      const body = translate(lang, parts[0], vars);
      pushToUser(userId, {
        title: actor ? `@${actor.username}` : 'STREETO',
        body,
        url: url || '/notifications',
        tag: `notif-${type}-${entityId || id}`,
        category: category || categoryForType(type),
      });
    } catch {
      /* push is best-effort; the activity row is already saved */
    }
  }

  return id;
}

export function recent(userId, { limit = 40, unreadOnly = false, category = null } = {}) {
  const where = ['n.user_id = ?'];
  const params = [userId];
  if (unreadOnly) where.push('n.read_at IS NULL');
  const types = category && NOTIFICATION_CATEGORIES[category];
  if (types?.length) {
    where.push(`n.type IN (${types.map(() => '?').join(', ')})`);
    params.push(...types);
  }
  params.push(limit);
  return all(
    `SELECT n.*, u.username AS actor_username, u.display_name AS actor_display_name, u.avatar AS actor_avatar
       FROM notifications n
       LEFT JOIN users u ON u.id = n.actor_id
      WHERE ${where.join(' AND ')}
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT ?`,
    ...params,
  );
}

export const byId = (userId, id) =>
  get('SELECT * FROM notifications WHERE id = ? AND user_id = ?', id, userId);

export function markRead(userId, id) {
  run(
    `UPDATE notifications
        SET read_at = COALESCE(read_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      WHERE id = ? AND user_id = ?`,
    id,
    userId,
  );
}

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

export default {
  notify,
  notifyAdmins,
  recent,
  byId,
  unreadCount,
  markRead,
  markAllRead,
  clearAll,
  alreadyNotified,
};
