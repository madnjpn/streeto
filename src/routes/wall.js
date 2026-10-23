import express from 'express';
import * as posts from '../models/posts.js';
import * as users from '../models/users.js';
import * as friends from '../models/friends.js';
import * as groups from '../models/groups.js';
import * as meetups from '../models/meetups.js';
import * as reports from '../models/reports.js';
import * as polls from '../models/polls.js';
import * as notifications from '../models/notifications.js';
import { requireAuth } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { postUpload, optimizeAs, removeUpload } from '../lib/uploads.js';
import { buildPost } from '../lib/post-form.js';
import { wantsJson, backTo, pagination, jsonOk, jsonError } from '../lib/http.js';
import { cleanText } from '../lib/validate.js';
import { relativeUploadPath } from '../lib/upload-paths.js';
import { extractMentions } from '../models/chat.js';
import { renderView } from '../lib/views.js';
import { formatText } from '../lib/format.js';

const router = express.Router();

/** Render one comment bubble server-side so the client inserts HTML. */
const renderComment = (res, comment, post, moderator, { reply = false, replies = '' } = {}) =>
  renderView('partials/comment', {
    ...res.locals,
    c: comment,
    post,
    moderator,
    reply,
    replies,
    reactions: comment.reactions || [],
  });

/**
 * The replies under one comment, rendered as a block.
 *
 * A reply can be answered as well, so the tree is followed a couple of
 * levels down - otherwise the answer to a reply would vanish the moment
 * the page is loaded again.
 */
const MAX_REPLY_DEPTH = 2;
const renderReplies = async (res, parentId, post, moderator, viewerId = 0, depth = 0) => {
  const replies = posts.attachCommentReactions(posts.commentReplies(parentId), viewerId);
  const rendered = await Promise.all(replies.map(async (reply) => renderComment(res, reply, post, moderator, {
    reply: true,
    replies: depth < MAX_REPLY_DEPTH
      ? await renderReplies(res, reply.id, post, moderator, viewerId, depth + 1)
      : '',
  })));
  return rendered.join('');
};

/** The whole thread of a post, top level comments with their replies. */
const renderThread = async (res, post, moderator, viewerId = 0) => {
  const list = posts.attachCommentReactions(posts.comments(post.id, 200), viewerId);
  const rendered = await Promise.all(list.map(async (comment) => renderComment(res, comment, post, moderator, {
    replies: await renderReplies(res, comment.id, post, moderator, viewerId),
  })));
  return { html: rendered.join(''), list };
};

const SCOPES = {
  everyone: 'Everyone',
  mygroup: 'My group',
};

/* ── the wall ─────────────────────────────────────────────────── */
router.get('/', (req, res) => {
  // Guests get the login page instead of an empty wall.
  if (!req.user && !req.query.view) return res.redirect('/login');

  const scope = SCOPES[req.query.view] ? req.query.view : 'everyone';
  const { page, perPage, offset } = pagination(req.query, { perPage: 20 });
  const viewerId = req.user?.id ?? 0;

  const feed = posts.feed({ scope, viewerId, limit: perPage + 1, offset });
  const hasMore = feed.length > perPage;
  const items = hasMore ? feed.slice(0, perPage) : feed;

  const total = posts.countFor({ scope, viewerId });

  return res.page('wall/index', {
    title: `${req.app.locals.config.siteName} - ${SCOPES[scope]}`,
    active: 'wall',
    scope,
    scopes: SCOPES,
    items,
    hasMore,
    page,
    total,
    friendCount: req.user ? friends.friendCount(req.user.id) : 0,
    postCount: req.user ? posts.countByUser(req.user.id) : 0,
    groupCount: req.user ? groups.myGroups(req.user.id).filter((g) => g.status === 'active').length : 0,
    suggestions: req.user ? users.suggestions(req.user.id, 5) : [],
    recentMembers: req.user ? [] : users.recentMembers(6),
    incoming: req.user ? friends.incomingRequests(req.user.id).slice(0, 4) : [],
    myGroups: req.user ? groups.myGroups(req.user.id).filter((g) => g.status === 'active').slice(0, 5) : [],
    upcoming: meetups.list({ scope: 'upcoming', viewerId, limit: 3 }),
    trending: posts.trendingTags(7, 8),
  });
});

/* ── create a post on the wall ────────────────────────────────── */
router.post('/posts', requireAuth, postUpload, optimizeAs('wall'), verifyCsrf, (req, res) => {
  const result = buildPost(req, { userId: req.user.id });

  if (!result.ok) {
    req.flash('error', result.error);
    return res.redirect(backTo(req, '/'));
  }

  if (result.postType === 'emergency') {
    req.flash('warning', 'SOS posted. Your location is on the wall - stay somewhere visible.');
  } else {
    req.flash('success', 'Posted.');
  }
  return res.redirect(backTo(req, '/'));
});

/* ── a single post ────────────────────────────────────────────── */
router.get('/posts/:id', async (req, res, next) => {
  try {
    const post = posts.byId(Number(req.params.id), req.user?.id ?? 0);
    if (!post) return next();

    if (post.group_id) {
      const group = groups.byId(post.group_id);
      if (!groups.canView(group, req.user?.id ?? 0)) {
        req.flash('error', 'That post belongs to a group you are not part of.');
        return res.redirect('/groups');
      }
      return res.redirect(`/groups/${group.slug}#post-${post.id}`);
    }

    // The comments come down with the page, replies and all.
    const moderator = false;
    const { html: commentsHtml } = await renderThread(res, post, moderator, req.user?.id ?? 0);

    return res.page('wall/post', {
      title: `${req.app.locals.config.siteName} - post by @${post.username}`,
      active: 'wall',
      post,
      commentsHtml,
      likedBy: posts.likedBy(post.id),
    });
  } catch (error) {
    return next(error);
  }
});

/* ── delete a post ────────────────────────────────────────────── */
router.post('/posts/:id/delete', requireAuth, verifyCsrf, (req, res, next) => {
  const post = posts.byId(Number(req.params.id), req.user.id);
  if (!post) return next();

  let asModerator = Boolean(req.user.is_admin);
  let redirect = backTo(req, '/');

  if (post.group_id) {
    const group = groups.byId(post.group_id);
    asModerator = asModerator || Boolean(groups.staffRole(post.group_id, req.user.id));
    redirect = `/groups/${group?.slug ?? ''}`;
    if (!asModerator && post.user_id !== req.user.id) {
      req.flash('error', 'You can only delete your own posts.');
      return res.redirect(redirect);
    }
  }

  const removed = posts.remove(post.id, req.user.id, { asModerator });
  req.flash(removed ? 'success' : 'error', removed ? 'Post deleted.' : 'Could not delete that post.');
  return res.redirect(redirect);
});

/* ── likes ────────────────────────────────────────────────────── */
router.post('/posts/:id/like', requireAuth, verifyCsrf, (req, res, next) => {
  const post = posts.byId(Number(req.params.id), req.user.id);
  if (!post) return next();

  const result = posts.toggleLike(post.id, req.user.id);

  if (result.liked && !notifications.alreadyNotified({
    userId: post.user_id,
    actorId: req.user.id,
    type: 'like',
    entityId: post.id,
  })) {
    notifications.notify({
      userId: post.user_id,
      actorId: req.user.id,
      type: 'like',
      entityId: post.id,
      url: post.group_id ? `/groups/${post.group_slug}#post-${post.id}` : `/posts/${post.id}`,
      text: 'liked your post',
    });
  }

  if (wantsJson(req)) return jsonOk(res, { liked: result.liked, likes: result.count });
  return res.redirect(backTo(req, '/'));
});

/** Who liked it - used by the hover/tap popover. */
router.get('/posts/:id/likes', (req, res, next) => {
  const post = posts.byId(Number(req.params.id), req.user?.id ?? 0);
  if (!post) return next();
  return jsonOk(res, { users: posts.likedBy(post.id, 50) });
});

/* ── comments ─────────────────────────────────────────────────── */
/** Comments for the "load on expand" behaviour. */
router.get('/posts/:id/comments', async (req, res, next) => {
  try {
    const post = posts.byId(Number(req.params.id), req.user?.id ?? 0);
    if (!post) return next();

    // A post inside a group is only for the people who may read it.
    if (post.group_id) {
      const group = groups.byId(post.group_id);
      if (!groups.canView(group, req.user?.id ?? 0)) {
        return jsonError(res, 'You cannot read that post.', 403);
      }
    }

    const moderator = post.group_id ? Boolean(groups.staffRole(post.group_id, req.user?.id ?? 0)) : false;
    const { html, list } = await renderThread(res, post, moderator, req.user?.id ?? 0);

    return jsonOk(res, {
      html,
      count: list.length,
      comments: list.map((comment) => ({
        id: comment.id,
        body: comment.body,
        created_at: comment.created_at,
        username: comment.username,
        display_name: comment.display_name,
        avatar: comment.avatar,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/posts/:id/comments', requireAuth, postUpload, optimizeAs('chat'), verifyCsrf, async (req, res, next) => {
  try {
    const post = posts.byId(Number(req.params.id), req.user.id);
    if (!post) return next();

    // A post inside a group is only for the people who may read it.
    if (post.group_id) {
      const group = groups.byId(post.group_id);
      if (!groups.canView(group, req.user.id)) {
        if (wantsJson(req)) return jsonError(res, 'You cannot read that post.', 403);
        req.flash('error', 'You cannot read that post.');
        return res.redirect(backTo(req, '/'));
      }
    }

    const body = cleanText(req.body.body ?? req.body.comment ?? '', 1000);
    const mediaPath = req.file ? relativeUploadPath(req.file.path) : null;
    const mediaType = req.file ? (req.file.mimetype?.startsWith('video/') ? 'video' : 'photo') : null;
    if (!body && !mediaPath) {
      if (wantsJson(req)) return jsonError(res, 'Write something or attach a photo.');
      req.flash('error', 'Write something or attach a photo.');
      return res.redirect(backTo(req, '/'));
    }

    // A reply hangs under the comment it answers.
    const parentId = Number(req.body.parent_id) || null;
    let parent = null;
    if (parentId) {
      parent = posts.commentById(parentId);
      if (!parent || parent.post_id !== post.id) {
        if (wantsJson(req)) return jsonError(res, 'That comment is gone.');
        req.flash('error', 'That comment is gone.');
        return res.redirect(backTo(req, '/'));
      }
    }

    const comment = posts.addComment({ postId: post.id, userId: req.user.id, body, parentId: parent ? parentId : null, mediaPath, mediaType });
    const refreshed = posts.byId(post.id, req.user.id);

    notifications.notify({
      userId: post.user_id,
      actorId: req.user.id,
      type: 'comment',
      entityId: post.id,
      url: post.group_id ? `/groups/${post.group_slug}#post-${post.id}` : `/posts/${post.id}`,
      text: 'commented on your post',
    });

    // The person who wrote the comment we are answering.
    if (parent && parent.user_id !== req.user.id) {
      notifications.notify({
        userId: parent.user_id,
        actorId: req.user.id,
        type: 'comment',
        entityId: post.id,
        url: post.group_id ? `/groups/${post.group_slug}#post-${post.id}` : `/posts/${post.id}`,
        text: 'replied to your comment',
      });
    }

    // @name in a comment gets a notification too.
    for (const username of extractMentions(body)) {
      const mentioned = users.findByUsername(username);
      if (!mentioned || mentioned.id === req.user.id) continue;
      if (mentioned.id === post.user_id) continue;
      notifications.notify({
        userId: mentioned.id,
        actorId: req.user.id,
        type: 'comment',
        entityId: post.id,
        url: post.group_id ? `/groups/${post.group_slug}#post-${post.id}` : `/posts/${post.id}`,
        text: 'mentioned you in a comment',
      });
    }

    if (wantsJson(req)) {
      const moderator = post.group_id ? Boolean(groups.staffRole(post.group_id, req.user.id)) : false;
      posts.attachCommentReactions([comment], req.user.id);
      const html = await renderComment(res, comment, post, moderator, { reply: Boolean(parent) });
      const replies = parent ? await renderReplies(res, parent.id, post, moderator, req.user.id) : '';
      return jsonOk(res, {
        html,
        replies,
        parent_id: parent ? parent.id : null,
        count: refreshed.comment_count,
        comment: {
          id: comment.id,
          body: comment.body,
          created_at: comment.created_at,
          username: comment.username,
          display_name: comment.display_name,
          avatar: comment.avatar,
        },
      });
    }
    return res.redirect(`${backTo(req, '/')}#post-${post.id}`);
  } catch (error) {
    return next(error);
  }
});

router.post('/comments/:id/delete', requireAuth, verifyCsrf, (req, res, next) => {
  const comment = posts.commentById(Number(req.params.id));
  if (!comment) return next();

  const post = posts.byId(comment.post_id, req.user.id);
  const asModerator = post?.group_id ? Boolean(groups.staffRole(post.group_id, req.user.id)) : false;
  const isPostAuthor = post?.user_id === req.user.id;

  const removed = posts.removeComment(comment.id, req.user.id, { asModerator, isPostAuthor });
  if (removed && comment.media_path) {
    try { removeUpload(comment.media_path); } catch { /* already gone */ }
  }
  if (wantsJson(req)) {
    if (!removed) return jsonError(res, 'You cannot delete that comment.', 403);
    return jsonOk(res, { id: comment.id });
  }
  if (!removed) req.flash('error', 'You cannot delete that comment.');
  return res.redirect(backTo(req, '/'));
});

/* ── react to a comment ────────────────────────────────────────── */
/**
 * Press an emoji on a comment. Pressing the same emoji again takes it
 * back. The people who can see the comment can react to it.
 */
router.post('/comments/:id/react', requireAuth, verifyCsrf, (req, res) => {
  const comment = posts.commentById(Number(req.params.id));
  if (!comment) return jsonError(res, 'That comment is gone.', 404);

  const emoji = String(req.body.emoji ?? '').trim().slice(0, 8);
  if (!emoji) return jsonError(res, 'Pick an emoji.', 400);

  const reactions = posts.toggleCommentReaction({
    commentId: comment.id,
    userId: req.user.id,
    emoji,
  });
  if (!reactions) return jsonError(res, 'That comment is gone.', 404);
  return jsonOk(res, { reactions });
});

/* ── edit a comment ─────────────────────────────────────────────── */
/**
 * The person who wrote a comment can change it. The people who moderate
 * the place it hangs in can change it too. The comment then shows that
 * it was edited, so nobody is misled about what was said.
 */
router.post('/comments/:id/edit', requireAuth, verifyCsrf, async (req, res, next) => {
  try {
    const comment = posts.commentById(Number(req.params.id));
    if (!comment) return next();

    const post = posts.byId(comment.post_id, req.user.id);
    const asModerator = Boolean(req.user.is_admin)
      || Boolean(post?.group_id && groups.staffRole(post.group_id, req.user.id));

    const body = cleanText(req.body.body ?? '', 1000);
    if (!body) {
      if (wantsJson(req)) return jsonError(res, 'Write something first.');
      req.flash('error', 'Write something first.');
      return res.redirect(backTo(req, '/'));
    }

    // Only the person who wrote it may change the words. A moderator of
    // the place may do it too; the author of the post may not.
    const updated = posts.editComment({
      commentId: comment.id,
      userId: req.user.id,
      body,
      asModerator,
    });
    if (!updated) {
      if (wantsJson(req)) return jsonError(res, 'That comment cannot be edited.', 403);
      req.flash('error', 'That comment cannot be edited.');
      return res.redirect(backTo(req, '/'));
    }

    if (wantsJson(req)) {
      return jsonOk(res, {
        body_html: formatText(updated.body),
        edited_at: updated.edited_at || null,
        comment: { id: updated.id, body: updated.body },
      });
    }
    req.flash('success', 'Comment updated.');
    return res.redirect(backTo(req, '/'));
  } catch (error) {
    return next(error);
  }
});

/* ── edit a post ────────────────────────────────────────────────── */
/**
 * The person who wrote a post can change the words of it, and so can
 * the people who moderate the place it stands in. The hashtags follow
 * the new text.
 */
router.post('/posts/:id/edit', requireAuth, verifyCsrf, async (req, res, next) => {
  try {
    const post = posts.byId(Number(req.params.id), req.user.id);
    if (!post) return next();

    const asModerator = Boolean(req.user.is_admin)
      || Boolean(post.group_id && groups.staffRole(post.group_id, req.user.id));

    const body = cleanText(req.body.body ?? '', 5000);
    if (!body) {
      if (wantsJson(req)) return jsonError(res, 'Write something first.');
      req.flash('error', 'Write something first.');
      return res.redirect(backTo(req, '/'));
    }

    const updated = posts.editPost({ postId: post.id, userId: req.user.id, body, asModerator });
    if (!updated) {
      if (wantsJson(req)) return jsonError(res, 'That post cannot be edited.', 403);
      req.flash('error', 'That post cannot be edited.');
      return res.redirect(backTo(req, '/'));
    }

    if (wantsJson(req)) {
      const tagsHtml = renderView('partials/post-tags', { ...res.locals, post: updated });
      return jsonOk(res, {
        body_html: formatText(updated.body),
        edited_at: updated.edited_at || null,
        tags_html: tagsHtml,
        post: { id: updated.id, body: updated.body },
      });
    }
    req.flash('success', 'Post updated.');
    return res.redirect(backTo(req, '/'));
  } catch (error) {
    return next(error);
  }
});

/* ── report content ───────────────────────────────────────────── */
router.post('/reports', requireAuth, verifyCsrf, (req, res) => {
  const targetType = String(req.body.target_type ?? '').trim();
  const targetId = Number(req.body.target_id);
  const reason = cleanText(req.body.reason ?? 'inappropriate', 200);
  const allowed = ['post', 'user', 'group', 'build', 'meetup', 'comment'];
  if (!allowed.includes(targetType) || !Number.isFinite(targetId) || targetId < 1) {
    req.flash('error', 'Could not file that report.');
    return res.redirect(backTo(req, '/'));
  }
  reports.create({ reporterId: req.user.id, targetType, targetId, reason: reason || 'inappropriate' });
  req.flash('success', 'Report filed. An admin will review it.');
  return res.redirect(backTo(req, '/'));
});

/* ── poll vote ────────────────────────────────────────────────── */
router.post('/posts/:id/poll/vote', requireAuth, verifyCsrf, (req, res, next) => {
  const post = posts.byId(Number(req.params.id), req.user.id);
  if (!post || !post.poll) return next();
  const optionId = Number(req.body.option_id);
  if (!Number.isFinite(optionId)) return res.redirect(backTo(req, '/'));
  polls.vote(post.poll.id, optionId, req.user.id);
  return res.redirect(backTo(req, '/'));
});

export default router;
