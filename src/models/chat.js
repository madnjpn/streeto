import { all, get, run } from '../db.js';
import { removeUpload } from '../lib/uploads.js';
import * as users from '../models/users.js';

/**
 * Direct (1-to-1) chat.
 *
 * Each user has their own `cleared_at` marker, so "delete chat" only
 * hides the history for the person who asked for it: the other side
 * keeps the thread, and the conversation reappears for you if they
 * write again.
 */

const OTHER_USER = `
  SELECT u.id
    FROM conversation_members cm2
    JOIN users u ON u.id = cm2.user_id
   WHERE cm2.conversation_id = c.id AND cm2.user_id <> :me
   LIMIT 1
`;

/** The existing 2-person conversation between two users, if any. */
export const between = (a, b) =>
  get(
    `SELECT c.id
       FROM conversations c
       JOIN conversation_members m1 ON m1.conversation_id = c.id AND m1.user_id = :a
       JOIN conversation_members m2 ON m2.conversation_id = c.id AND m2.user_id = :b
      WHERE c.kind = 'dm'
        AND (SELECT COUNT(*) FROM conversation_members x WHERE x.conversation_id = c.id) = 2
      LIMIT 1`,
    { a, b },
  );

/** Find or create the conversation and make sure both users are in it. */
export function ensureConversation(a, b) {
  if (a === b) return null;
  const existing = between(a, b);
  if (existing) return { id: existing.id, created: false };

  const info = run('INSERT INTO conversations (created_by) VALUES (?)', a);
  const id = info.lastInsertRowid;
  run(
    `INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?), (?, ?)`,
    id,
    a,
    id,
    b,
  );
  return { id, created: true };
}

/**
 * Inbox: one row per conversation, with the other member, the latest
 * message and this user's unread count. Chats the user deleted are
 * hidden until a newer message arrives.
 */
export const listConversations = (userId) =>
  all(
    `SELECT
        c.id,
        c.created_at,
        cm.cleared_at,
        (${OTHER_USER}) AS other_id,
        (SELECT u.username FROM conversation_members cm2 JOIN users u ON u.id = cm2.user_id
           WHERE cm2.conversation_id = c.id AND cm2.user_id <> :me LIMIT 1) AS other_username,
        (SELECT u.display_name FROM conversation_members cm2 JOIN users u ON u.id = cm2.user_id
           WHERE cm2.conversation_id = c.id AND cm2.user_id <> :me LIMIT 1) AS other_display_name,
        (SELECT u.avatar FROM conversation_members cm2 JOIN users u ON u.id = cm2.user_id
           WHERE cm2.conversation_id = c.id AND cm2.user_id <> :me LIMIT 1) AS other_avatar,
        (SELECT m.body FROM messages m WHERE m.conversation_id = c.id
           AND (cm.cleared_at IS NULL OR m.created_at > cm.cleared_at)
          ORDER BY m.id DESC LIMIT 1) AS last_body,
        (SELECT m.media_type FROM messages m WHERE m.conversation_id = c.id
           AND (cm.cleared_at IS NULL OR m.created_at > cm.cleared_at)
          ORDER BY m.id DESC LIMIT 1) AS last_media_type,
        (SELECT m.share_type FROM messages m WHERE m.conversation_id = c.id
           AND (cm.cleared_at IS NULL OR m.created_at > cm.cleared_at)
          ORDER BY m.id DESC LIMIT 1) AS last_share_type,
        (SELECT m.share_title FROM messages m WHERE m.conversation_id = c.id
           AND (cm.cleared_at IS NULL OR m.created_at > cm.cleared_at)
          ORDER BY m.id DESC LIMIT 1) AS last_share_title,
        (SELECT m.created_at FROM messages m WHERE m.conversation_id = c.id
           AND (cm.cleared_at IS NULL OR m.created_at > cm.cleared_at)
          ORDER BY m.id DESC LIMIT 1) AS last_at,
        (SELECT m.sender_id FROM messages m WHERE m.conversation_id = c.id
           AND (cm.cleared_at IS NULL OR m.created_at > cm.cleared_at)
          ORDER BY m.id DESC LIMIT 1) AS last_sender_id,
        (SELECT COUNT(*) FROM messages m
           WHERE m.conversation_id = c.id AND m.sender_id <> :me AND m.id > cm.last_read_id
             AND (cm.cleared_at IS NULL OR m.created_at > cm.cleared_at)) AS unread
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = :me
      WHERE c.kind = 'dm'
        AND EXISTS (
        SELECT 1 FROM messages m WHERE m.conversation_id = c.id
         AND (cm.cleared_at IS NULL OR m.created_at > cm.cleared_at))
      ORDER BY last_at DESC`,
    { me: userId },
  );

/** One conversation header (other member + unread) for the chat page. */
export const summary = (conversationId, userId) =>
  get(
    `SELECT c.id, c.created_at, c.kind, c.name, c.topic, cm.cleared_at, cm.last_read_id,
            (SELECT COUNT(*) FROM conversation_members x WHERE x.conversation_id = c.id) AS member_count,
            (${OTHER_USER}) AS other_id,
            (SELECT u.username FROM conversation_members cm2 JOIN users u ON u.id = cm2.user_id
               WHERE cm2.conversation_id = c.id AND cm2.user_id <> :me LIMIT 1) AS other_username,
            (SELECT u.display_name FROM conversation_members cm2 JOIN users u ON u.id = cm2.user_id
               WHERE cm2.conversation_id = c.id AND cm2.user_id <> :me LIMIT 1) AS other_display_name,
            (SELECT u.avatar FROM conversation_members cm2 JOIN users u ON u.id = cm2.user_id
               WHERE cm2.conversation_id = c.id AND cm2.user_id <> :me LIMIT 1) AS other_avatar,
            (SELECT u.car FROM conversation_members cm2 JOIN users u ON u.id = cm2.user_id
               WHERE cm2.conversation_id = c.id AND cm2.user_id <> :me LIMIT 1) AS other_car
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = :me
      WHERE c.id = :id`,
    { me: userId, id: conversationId },
  );

export const isMember = (conversationId, userId) =>
  Boolean(get('SELECT 1 AS x FROM conversation_members WHERE conversation_id = ? AND user_id = ?', conversationId, userId));

export const memberIds = (conversationId) =>
  all('SELECT user_id FROM conversation_members WHERE conversation_id = ?', conversationId).map((r) => r.user_id);

/* ── the open global channel ──────────────────────────────────── */

/** The single global conversation row that every member shares. */
export const globalChannel = () =>
  get(`SELECT id, kind, name, topic, created_by, created_at FROM conversations WHERE kind = 'global'`) ?? null;

/** Add a member to the global channel (called once on register). */
export function joinGlobal(userId) {
  const channel = globalChannel();
  if (!channel) return null;
  run(
    'INSERT OR IGNORE INTO conversation_members (conversation_id, user_id) VALUES (?, ?)',
    channel.id,
    userId,
  );
  return channel.id;
}

/** The global channel with this member's unread count and last message. */
export function globalConversation(userId) {
  const channel = globalChannel();
  if (!channel) return null;
  joinGlobal(userId);
  return (
    get(
      `SELECT c.id, c.kind, c.name, c.topic, cm.cleared_at, cm.last_read_id,
              (SELECT COUNT(*) FROM conversation_members x WHERE x.conversation_id = c.id) AS member_count,
              (SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_body,
              (SELECT m.media_type FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_media_type,
              (SELECT m.share_type FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_share_type,
              (SELECT m.share_title FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_share_title,
              (SELECT m.created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_at,
              (SELECT m.sender_id FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_sender_id,
              (SELECT u.username FROM messages m JOIN users u ON u.id = m.sender_id
                WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_sender_username,
              (SELECT COUNT(*) FROM messages m
                WHERE m.conversation_id = c.id AND m.sender_id <> :me AND m.id > cm.last_read_id) AS unread
         FROM conversations c
         JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = :me
        WHERE c.kind = 'global'`,
      { me: userId },
    ) ?? null
  );
}

/**
 * Messages in a conversation, oldest first. `afterId` gives the client
 * a cheap way to poll for just what is new.
 */
export function messages(conversationId, userId, { afterId = 0, limit = 200 } = {}) {
  const rows = all(
    `SELECT m.id, m.body, m.media_type, m.media_path, m.file_name, m.file_size, m.parent_id,
            m.share_type, m.share_id, m.share_title, m.share_text, m.share_image,
            m.created_at, m.edited_at, m.sender_id,
            u.username, u.display_name, u.avatar,
            pm.body AS parent_body,
            pu.username AS parent_username,
            pu.display_name AS parent_display_name
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = :me
       LEFT JOIN messages pm ON pm.id = m.parent_id
       LEFT JOIN users pu ON pu.id = pm.sender_id
      WHERE m.conversation_id = :id
        AND m.id > :after
        AND (cm.cleared_at IS NULL OR m.created_at > cm.cleared_at)
      ORDER BY m.id ASC
      LIMIT :limit`,
    { me: userId, id: conversationId, after: afterId, limit },
  );
  attachReactions(rows, userId);
  return rows;
}

/* ── reactions ─────────────────────────────────────────────────── */

/** The reactions on each of these messages, with who pressed what. */
export function attachReactions(messages, viewerId = 0) {
  if (!messages.length) return messages;
  const ids = messages.map((m) => m.id);
  const rows = all(
    `SELECT r.message_id, r.emoji, r.user_id, u.username, u.display_name, u.avatar
       FROM message_reactions r JOIN users u ON u.id = r.user_id
      WHERE r.message_id IN (${ids.map(() => '?').join(',')})
      ORDER BY r.id ASC`,
    ...ids,
  );
  const byMessage = new Map();
  for (const row of rows) {
    if (!byMessage.has(row.message_id)) byMessage.set(row.message_id, []);
    byMessage.get(row.message_id).push(row);
  }
  for (const message of messages) {
    const list = byMessage.get(message.id) || [];
    const groups = new Map();
    for (const row of list) {
      if (!groups.has(row.emoji)) groups.set(row.emoji, { emoji: row.emoji, count: 0, mine: false, who: [] });
      const group = groups.get(row.emoji);
      group.count += 1;
      if (row.user_id === viewerId) group.mine = true;
      group.who.push({ username: row.username, display_name: row.display_name, avatar: row.avatar });
    }
    message.reactions = [...groups.values()];
  }
  return messages;
}

/** Press an emoji on a message, or press it again to take it back. */
export function toggleReaction({ messageId, userId, emoji }) {
  const clean = String(emoji ?? '').trim().slice(0, 8);
  if (!clean) return false;
  const existing = get(
    'SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?',
    messageId,
    userId,
    clean,
  );
  if (existing) {
    run('DELETE FROM message_reactions WHERE id = ?', existing.id);
    return false;
  }
  run(
    'INSERT OR IGNORE INTO message_reactions (message_id, user_id, emoji) VALUES (?, ?, ?)',
    messageId,
    userId,
    clean,
  );
  return true;
}

/** The message a reply points at, so the thread can show the quote. */
export const messageById = (id) =>
  get(
    `SELECT m.id, m.body, m.media_type, m.sender_id, u.username, u.display_name, u.avatar
       FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`,
    id,
  );

export function sendMessage({
  conversationId,
  senderId,
  body = null,
  mediaType = null,
  mediaPath = null,
  fileName = null,
  fileSize = null,
  parentId = null,
  share = null,
  notifications = null,
}) {
  const info = run(
    `INSERT INTO messages (conversation_id, sender_id, body, media_type, media_path, file_name, file_size, parent_id,
                           share_type, share_id, share_title, share_text, share_image)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    conversationId,
    senderId,
    body,
    mediaType,
    mediaPath,
    fileName,
    fileSize,
    parentId,
    share?.type || null,
    share?.id || null,
    share?.title || null,
    share?.text || null,
    share?.image || null,
  );
  markRead(conversationId, senderId, info.lastInsertRowid);
  const msg = get(
    `SELECT m.id, m.body, m.media_type, m.media_path, m.file_name, m.file_size, m.parent_id,
            m.share_type, m.share_id, m.share_title, m.share_text, m.share_image,
            m.created_at, m.edited_at, m.sender_id,
            u.username, u.display_name, u.avatar,
            pm.body AS parent_body,
            pu.username AS parent_username,
            pu.display_name AS parent_display_name
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       LEFT JOIN messages pm ON pm.id = m.parent_id
       LEFT JOIN users pu ON pu.id = pm.sender_id
      WHERE m.id = ?`,
    info.lastInsertRowid,
  );
  attachReactions([msg], senderId);

  // Handle mentions
  if (body) {
    const mentions = extractMentions(body);
    const channel = get('SELECT kind, name FROM conversations WHERE id = ?', conversationId);
    const isGlobal = channel?.kind === 'global';
    mentions.forEach((username) => {
      const mentioned = users.findByUsername(username);
      if (!mentioned || mentioned.id === senderId) return;
      // Only notify if they're a member of the conversation (or it's global)
      if (isGlobal || isMember(conversationId, mentioned.id)) {
        if (notifications) {
          notifications.notify({
            userId: mentioned.id,
            actorId: senderId,
            type: 'chat_mention',
            entityId: msg.id,
            url: isGlobal ? '/chat/' + conversationId : '/chat/' + conversationId,
            text: 'mentioned you in {name}|' + (isGlobal ? 'global channel' : 'chat'),
          });
        }
      }
    });
  }

  return msg;
}

export function markRead(conversationId, userId, upToId = null) {
  const latest =
    upToId ??
    get('SELECT MAX(id) AS id FROM messages WHERE conversation_id = ?', conversationId)?.id ??
    0;
  run(
    `UPDATE conversation_members
        SET last_read_id = MAX(last_read_id, ?)
      WHERE conversation_id = ? AND user_id = ?`,
    latest || 0,
    conversationId,
    userId,
  );
}

/** Delete a chat for one user only. The global channel cannot be deleted. */
export function deleteForUser(conversationId, userId) {
  const conversation = get('SELECT id, kind FROM conversations WHERE id = ?', conversationId);
  if (!conversation) return { purged: false, missing: true };
  if (conversation.kind === 'global') return { purged: false, blocked: true };

  run(
    `UPDATE conversation_members
        SET cleared_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), last_read_id = 0
      WHERE conversation_id = ? AND user_id = ?`,
    conversationId,
    userId,
  );

  // If nobody can see it any more, drop the whole thread.
  const stillVisible = get(
    `SELECT COUNT(*) AS n FROM conversation_members
      WHERE conversation_id = :id AND (cleared_at IS NULL
        OR EXISTS (SELECT 1 FROM messages m
                    WHERE m.conversation_id = :id AND m.created_at > conversation_members.cleared_at))`,
    { id: conversationId },
  ).n;

  if (stillVisible === 0) {
    const files = all('SELECT media_path FROM messages WHERE conversation_id = ? AND media_path IS NOT NULL', conversationId);
    run('DELETE FROM conversations WHERE id = ?', conversationId);
    files.forEach((row) => removeUpload(row.media_path));
    return { purged: true };
  }
  return { purged: false };
}

/**
 * Edit a message. Only the person who wrote it may change it, and the
 * text is kept within the same limits as a new message.
 */
export function editMessage({ messageId, userId, body, asAdmin = false }) {
  const msg = get('SELECT * FROM messages WHERE id = ?', messageId);
  if (!msg) return null;
  if (!asAdmin && msg.sender_id !== userId) return null;
  const text = String(body ?? '').trim().slice(0, 4000);
  if (!text) return null;
  run(
    `UPDATE messages
        SET body = ?, edited_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`,
    text,
    messageId,
  );
  return get(
    `SELECT m.id, m.body, m.media_type, m.media_path, m.file_name, m.file_size, m.parent_id,
            m.created_at, m.edited_at, m.sender_id,
            u.username, u.display_name, u.avatar,
            pm.body AS parent_body,
            pu.username AS parent_username,
            pu.display_name AS parent_display_name
       FROM messages m
       JOIN users u ON u.id = m.sender_id
       LEFT JOIN messages pm ON pm.id = m.parent_id
       LEFT JOIN users pu ON pu.id = pm.sender_id
      WHERE m.id = ?`,
    messageId,
  );
}

/** Delete a single message (admin or sender). Returns true if deleted. */
export function deleteMessage(messageId, userId, { asAdmin = false } = {}) {
  const msg = get('SELECT * FROM messages WHERE id = ?', messageId);
  if (!msg) return false;
  if (!asAdmin && msg.sender_id !== userId) return false;
  // Remove media file if present
  if (msg.media_path) removeUpload(msg.media_path);
  run('DELETE FROM messages WHERE id = ?', messageId);
  return true;
}

/** Delete all messages in the global channel (admin only). */
export function clearGlobalChat(adminId) {
  const channel = globalChannel();
  if (!channel) return 0;
  const files = all('SELECT media_path FROM messages WHERE conversation_id = ? AND media_path IS NOT NULL', channel.id);
  files.forEach((row) => removeUpload(row.media_path));
  const info = run('DELETE FROM messages WHERE conversation_id = ?', channel.id);
  return info.changes;
}

/** Search messages in a conversation (or globally). */
export const searchMessages = (conversationId, query, limit = 30) => {
  const term = `%${String(query).trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
  return all(
    `SELECT m.id, m.body, m.media_type, m.created_at, m.sender_id,
            u.username, u.display_name, u.avatar
       FROM messages m
       JOIN users u ON u.id = m.sender_id
      WHERE m.conversation_id = :id
        AND m.body LIKE :like ESCAPE '\\'
      ORDER BY m.id DESC
      LIMIT :limit`,
    { id: conversationId, like: term, limit },
  );
};

/** Extract @mentions from message body. */
export function extractMentions(body) {
  if (!body) return [];
  const matches = body.match(/@([a-zA-Z0-9_]{3,20})/g) || [];
  return [...new Set(matches.map((m) => m.slice(1)))];
}

/** Used when an account is removed from the platform. */
export function deleteAllForUser(userId) {
  const ids = all('SELECT conversation_id FROM conversation_members WHERE user_id = ?', userId).map(
    (row) => row.conversation_id,
  );
  run('DELETE FROM conversation_members WHERE user_id = ?', userId);
  for (const id of ids) {
    const left = get('SELECT COUNT(*) AS n FROM conversation_members WHERE conversation_id = ?', id).n;
    if (left === 0) run('DELETE FROM conversations WHERE id = ?', id);
  }
  return ids.length;
}

export default {
  between, ensureConversation, listConversations, summary, isMember, memberIds,
  globalChannel, joinGlobal, globalConversation,
  messages, sendMessage, markRead, deleteForUser, deleteAllForUser,
  deleteMessage, clearGlobalChat, searchMessages, extractMentions,
  toggleReaction, attachReactions, messageById, editMessage,
};
