import { all, count, get, run } from '../db.js';
import { removeUpload } from '../lib/uploads.js';
import * as polls from './polls.js';

/** Pull #hashtags out of a post body. Returns unique lowercase tags. */
export function extractTags(body) {
  if (!body) return [];
  const matches = String(body).match(/#[\p{L}\p{N}_-]+/gu) || [];
  const seen = new Set();
  const tags = [];
  for (const m of matches) {
    const tag = m.slice(1).toLowerCase();
    if (tag.length >= 2 && tag.length <= 40 && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

export function storeTags(postId, tags) {
  for (const tag of tags) {
    try { run('INSERT OR IGNORE INTO post_tags (post_id, tag) VALUES (?, ?)', postId, tag); } catch {}
  }
}

/**
 * A post as the wall renders it: author details, aggregate counts and
 * whether the current viewer already liked it.
 */
export const POST_SELECT = `
  SELECT p.*,
         u.username, u.display_name, u.avatar,
         g.name AS group_name, g.slug AS group_slug, g.privacy AS group_privacy,
         (SELECT GROUP_CONCAT(tag, ',') FROM post_tags WHERE post_id = p.id) AS tags_csv,
         (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) AS like_count,
         (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
         EXISTS (SELECT 1 FROM post_likes pl WHERE pl.post_id = p.id AND pl.user_id = :viewer) AS liked
    FROM posts p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN groups g ON g.id = p.group_id
`;

export const byId = (id, viewerId = 0) => {
  const post = get(`${POST_SELECT} WHERE p.id = :id`, { id, viewer: viewerId });
  if (post) post.poll = polls.byPost(post.id);
  if (post && post.poll && viewerId) {
    post.poll.userVote = polls.userVote(post.poll.id, viewerId);
  }
  return post;
};

/**
 * SQL fragment: "a wall post this viewer may read".
 * Public posts are for everyone; a `friends` post is only for the author
 * and their accepted friends. Needs a `:viewer` parameter.
 * `alias` is the table qualifier ('' for an unaliased column).
 */
export const visibleToViewer = (alias = 'p') => {
  const col = (name) => (alias ? `${alias}.${name}` : name);
  return `
  (${col('privacy')} = 'public'
   OR ${col('user_id')} = :viewer
   OR ${col('user_id')} IN (
     SELECT CASE WHEN f.requester_id = :viewer THEN f.addressee_id ELSE f.requester_id END
       FROM friendships f
      WHERE f.status = 'accepted' AND (f.requester_id = :viewer OR f.addressee_id = :viewer)))`;
};

/**
 * Feed queries. `scope` decides the WHERE clause:
 *   group    - my posts + my friends' posts (the default wall)
 *   everyone - every post the viewer may read (public + friends only)
 *   me       - just my posts
 *   user     - one profile's posts the viewer may read
 *   group    - posts inside a group
 *   location - posts that carry a pin (meetup / emergency shares)
 *   shared   - things shared into a group, plus pin spots posted there
 */
export function feed({ scope = 'group', viewerId = 0, userId = 0, groupId = 0, limit = 20, offset = 0 }) {
  // node:sqlite rejects named parameters the statement does not use, so
  // each scope builds its own exact parameter set.
  const params = { viewer: viewerId, limit, offset };
  let where = 'p.group_id IS NULL';
  let order = 'p.created_at DESC, p.id DESC';

  switch (scope) {
    case 'everyone':
      where += ` AND ${visibleToViewer('p')}`;
      break;
    case 'me':
      params.user = viewerId;
      where += ' AND p.user_id = :user';
      break;
    case 'user':
      params.user = userId;
      where += ' AND p.user_id = :user';
      where += ` AND ${visibleToViewer('p')}`;
      break;
    case 'group':
      params.group = groupId;
      where = 'p.group_id = :group';
      break;
    case 'location':
      params.group = groupId;
      where =
        `p.lat IS NOT NULL AND p.lng IS NOT NULL AND (p.group_id IS NULL OR p.group_id = :group)
         AND ${visibleToViewer('p')}`;
      order = 'p.created_at DESC, p.id DESC';
      break;
    case 'shared':
      params.group = groupId;
      where = `p.group_id = :group AND (
        (p.share_type IS NOT NULL AND p.share_id IS NOT NULL)
        OR (p.post_type IN ('location', 'emergency') AND p.lat IS NOT NULL AND p.lng IS NOT NULL)
      )`;
      break;
    case 'mygroup':
    default:
      where += ` AND (p.user_id = :viewer OR p.user_id IN (
        SELECT CASE WHEN f.requester_id = :viewer THEN f.addressee_id ELSE f.requester_id END
          FROM friendships f
         WHERE f.status = 'accepted' AND (f.requester_id = :viewer OR f.addressee_id = :viewer)
      ))`;
      break;
  }

  const items = all(`${POST_SELECT} WHERE ${where} ORDER BY ${order} LIMIT :limit OFFSET :offset`, params);
  for (const item of items) {
    item.poll = polls.byPost(item.id);
    if (item.poll && viewerId) item.poll.userVote = polls.userVote(item.poll.id, viewerId);
  }
  return items;
}

export const countFor = ({ scope = 'group', viewerId = 0, userId = 0, groupId = 0 }) => {
  switch (scope) {
    case 'group':
      return get('SELECT COUNT(*) AS n FROM posts WHERE group_id = :group', { group: groupId }).n;
    case 'shared':
      return get(
        `SELECT COUNT(*) AS n FROM posts
           WHERE group_id = :group AND (
             (share_type IS NOT NULL AND share_id IS NOT NULL)
             OR (post_type IN ('location', 'emergency') AND lat IS NOT NULL AND lng IS NOT NULL)
           )`,
        { group: groupId },
      ).n;
    case 'me':
      return get('SELECT COUNT(*) AS n FROM posts WHERE group_id IS NULL AND user_id = :user', {
        user: userId || viewerId,
      }).n;
    case 'user':
      return get(
        `SELECT COUNT(*) AS n FROM posts
          WHERE group_id IS NULL AND user_id = :user AND ${visibleToViewer('')}`,
        { user: userId, viewer: viewerId },
      ).n;
    case 'everyone':
      return get(
        `SELECT COUNT(*) AS n FROM posts WHERE group_id IS NULL AND ${visibleToViewer('')}`,
        { viewer: viewerId },
      ).n;
    default:
      return get(
        `SELECT COUNT(*) AS n FROM posts
          WHERE group_id IS NULL
            AND (user_id = :viewer OR user_id IN (
              SELECT CASE WHEN f.requester_id = :viewer THEN f.addressee_id ELSE f.requester_id END
                FROM friendships f
               WHERE f.status = 'accepted' AND (f.requester_id = :viewer OR f.addressee_id = :viewer)))`,
        { viewer: viewerId },
      ).n;
  }
};

export function createPost({
  userId,
  groupId = null,
  body = null,
  postType = 'text',
  mediaType = null,
  mediaPath = null,
  placeName = null,
  address = null,
  lat = null,
  lng = null,
  zoom = null,
  privacy = 'public',
  shareType = null,
  shareId = null,
  shareTitle = null,
  shareText = null,
  shareImage = null,
  shareUrl = null,
}) {
  const info = run(
    `INSERT INTO posts (user_id, group_id, body, post_type, media_type, media_path, 
place_name, address, lat, lng, zoom, privacy,
share_type, share_id, share_title, share_text, share_image, share_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    userId,
    groupId,
    body,
    postType,
    mediaType,
    mediaPath,
    placeName,
    address,
    lat,
    lng,
    zoom,
    privacy === 'friends' ? 'friends' : 'public',
    shareType,
    shareId,
    shareTitle,
    shareText,
    shareImage,
    shareUrl,
  );
  // hashtags
  if (body) storeTags(info.lastInsertRowid, extractTags(body));
  return info.lastInsertRowid;
}

/** Only the author (or a group owner/admin) may remove a post. */
export function remove(id, viewerId, { asModerator = false } = {}) {
  const post = get('SELECT id, user_id, media_path FROM posts WHERE id = ?', id);
  if (!post) return false;
  if (post.user_id !== viewerId && !asModerator) return false;
  run('DELETE FROM posts WHERE id = ?', id);
  if (post.media_path) removeUpload(post.media_path);
  return true;
}

export function toggleLike(postId, userId) {
  const existing = get('SELECT 1 AS x FROM post_likes WHERE post_id = ? AND user_id = ?', postId, userId);
  if (existing) {
    run('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?', postId, userId);
    return { liked: false, count: count('post_likes', 'post_id = ?', postId) };
  }
  run('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)', postId, userId);
  return { liked: true, count: count('post_likes', 'post_id = ?', postId) };
}

export const likedBy = (postId, limit = 12) =>
  all(
    `SELECT u.id, u.username, u.display_name, u.avatar
       FROM post_likes pl JOIN users u ON u.id = pl.user_id
      WHERE pl.post_id = ? ORDER BY pl.created_at DESC LIMIT ?`,
    postId,
    limit,
  );

export const comments = (postId, limit = 100) =>
  all(
    `SELECT c.*, u.username, u.display_name, u.avatar
       FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.post_id = ? AND c.parent_id IS NULL
      ORDER BY c.created_at ASC LIMIT ?`,
    postId,
    limit,
  );

/** The replies under one comment, oldest first. */
export const commentReplies = (parentId) =>
  all(
    `SELECT c.*, u.username, u.display_name, u.avatar
       FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.parent_id = ? ORDER BY c.created_at ASC`,
    parentId,
  );

export const commentById = (id) =>
  get(
    `SELECT c.*, u.username, u.display_name, u.avatar
       FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`,
    id,
  );

export function addComment({ postId, userId, body, parentId = null, mediaPath = null, mediaType = null }) {
  const info = run(
    'INSERT INTO comments (post_id, user_id, body, parent_id, media_path, media_type) VALUES (?, ?, ?, ?, ?, ?)',
    postId,
    userId,
    body,
    parentId,
    mediaPath,
    mediaType,
  );
  return commentById(info.lastInsertRowid);
}

export function removeComment(id, viewerId, { asModerator = false, isPostAuthor = false } = {}) {
  const comment = get('SELECT id, user_id, post_id FROM comments WHERE id = ?', id);
  if (!comment) return false;
  if (comment.user_id !== viewerId && !asModerator && !isPostAuthor) return false;
  run('DELETE FROM comments WHERE id = ?', id);
  return true;
}

/**
 * Change the words of a comment. The person who wrote it may do that,
 * and so may the people who moderate the place it hangs in.
 */export function editComment({ commentId, userId, body, asModerator = false }) {
  const comment = get('SELECT id, user_id FROM comments WHERE id = ?', commentId);
  if (!comment) return null;
  if (comment.user_id !== userId && !asModerator) return null;
  const text = String(body ?? '').trim().slice(0, 1000);
  if (!text) return null;
  run(
    `UPDATE comments
        SET body = ?, edited_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`,
    text,
    commentId,
  );
  return commentById(commentId);
}

/**
 * Change the words of a post. The hashtags follow the new text, so a
 * #tag that was taken out stops showing up under the post.
 */
export function editPost({ postId, userId, body, asModerator = false }) {
  const post = get('SELECT id, user_id FROM posts WHERE id = ?', postId);
  if (!post) return null;
  if (post.user_id !== userId && !asModerator) return null;
  const text = String(body ?? '').trim().slice(0, 5000);
  if (!text) return null;
  run(
    `UPDATE posts
        SET body = ?, edited_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`,
    text,
    postId,
  );
  run('DELETE FROM post_tags WHERE post_id = ?', postId);
  storeTags(postId, extractTags(text));
  return byId(postId, userId);
}

/* ── reactions on the comments ──────────────────────────────────── */

/** The reactions on each of these comments, with who pressed what. */
export function attachCommentReactions(comments, viewerId = 0) {
  if (!comments || !comments.length) return comments;
  const ids = comments.map((c) => c.id);
  const rows = all(
    `SELECT r.comment_id, r.emoji, r.user_id, u.username, u.display_name, u.avatar
       FROM comment_reactions r JOIN users u ON u.id = r.user_id
      WHERE r.comment_id IN (${ids.map(() => '?').join(',')})
      ORDER BY r.id ASC`,
    ...ids,
  );
  const byComment = new Map();
  for (const row of rows) {
    if (!byComment.has(row.comment_id)) byComment.set(row.comment_id, []);
    byComment.get(row.comment_id).push(row);
  }
  for (const comment of comments) {
    const list = byComment.get(comment.id) || [];
    const groups = new Map();
    for (const row of list) {
      if (!groups.has(row.emoji)) groups.set(row.emoji, { emoji: row.emoji, count: 0, mine: false, who: [] });
      const group = groups.get(row.emoji);
      group.count += 1;
      if (row.user_id === viewerId) group.mine = true;
      group.who.push({ username: row.username, display_name: row.display_name, avatar: row.avatar });
    }
    comment.reactions = [...groups.values()];
  }
  return comments;
}

/** Press an emoji on a comment, or press it again to take it back. */
export function toggleCommentReaction({ commentId, userId, emoji }) {
  const clean = String(emoji ?? '').trim().slice(0, 8);
  if (!clean) return null;
  const comment = get('SELECT id FROM comments WHERE id = ?', commentId);
  if (!comment) return null;
  const existing = get(
    'SELECT id FROM comment_reactions WHERE comment_id = ? AND user_id = ? AND emoji = ?',
    commentId,
    userId,
    clean,
  );
  if (existing) {
    run('DELETE FROM comment_reactions WHERE id = ?', existing.id);
  } else {
    run(
      'INSERT OR IGNORE INTO comment_reactions (comment_id, user_id, emoji) VALUES (?, ?, ?)',
      commentId,
      userId,
      clean,
    );
  }
  const rows = all(
    `SELECT r.emoji, r.user_id, u.username, u.display_name, u.avatar
       FROM comment_reactions r JOIN users u ON u.id = r.user_id
      WHERE r.comment_id = ? ORDER BY r.id ASC`,
    commentId,
  );
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.emoji)) groups.set(row.emoji, { emoji: row.emoji, count: 0, mine: false, who: [] });
    const group = groups.get(row.emoji);
    group.count += 1;
    if (row.user_id === userId) group.mine = true;
    group.who.push({ username: row.username, display_name: row.display_name, avatar: row.avatar });
  }
  return [...groups.values()];
}

export const tagsForPost = (postId) =>
  all('SELECT tag FROM post_tags WHERE post_id = ? ORDER BY tag', postId).map((r) => r.tag);
export const postsByTag = (tag, { viewerId = 0, limit = 30, offset = 0 } = {}) =>
  all(
    `${POST_SELECT}
       WHERE p.group_id IS NULL AND ${visibleToViewer('p')}
         AND p.id IN (SELECT post_id FROM post_tags WHERE tag = ?)
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT ? OFFSET ?`,
    { tag: String(tag).toLowerCase(), viewer: viewerId, limit, offset },
  );

export const trendingTags = (days = 7, limit = 10) =>
  all(
    `SELECT tag, COUNT(*) AS n
       FROM post_tags pt JOIN posts p ON p.id = pt.post_id
      WHERE p.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-${days} days')
      GROUP BY tag ORDER BY n DESC, tag ASC LIMIT ?`,
    limit,
  );

export const countByUser = (userId) =>
  get('SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND group_id IS NULL', userId).n;

export default {
  feed, countFor, byId, createPost, remove, toggleLike, likedBy, comments,
  addComment, removeComment, countByUser, POST_SELECT,
};
