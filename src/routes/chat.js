import express from 'express';
import * as chat from '../models/chat.js';
import { pushToUser } from '../lib/push-all.js';
import * as users from '../models/users.js';
import * as friends from '../models/friends.js';
import * as notifications from '../models/notifications.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { chatUpload, removeUpload, mediaKind, isDocument, uploadUrl, optimizeAs } from '../lib/uploads.js';
import * as presence from '../lib/presence.js';
import { wantsJson, jsonOk, jsonError, backTo } from '../lib/http.js';
import { cleanText } from '../lib/validate.js';
import { renderView } from '../lib/views.js';
import { shareCard, shareUrl, SHARE_LABELS } from '../lib/share.js';
import { translate } from '../lib/i18n.js';

const router = express.Router();

// Every chat page needs a login.
router.use('/chat', requireAuth);

/** Render one message bubble server-side so the client never builds HTML. */
async function renderMessage(res, message, viewerId) {
  // The green dot on the avatar needs to know who is online.
  message.online = presence.isOnline(message.sender_id);
  const html = await renderView('partials/message', {
    ...res.locals,
    m: message,
    currentUser: { id: viewerId },
  });
  return {
    id: message.id,
    body: message.body,
    created_at: message.created_at,
    edited_at: message.edited_at || null,
    sender_id: message.sender_id,
    username: message.username,
    media_type: message.media_type,
    media_url: message.media_path ? uploadUrl(message.media_path) : null,
    file_name: message.file_name || null,
    file_size: message.file_size || null,
    parent_id: message.parent_id || null,
    share: message.share_type ? {
      type: message.share_type,
      id: message.share_id,
      title: message.share_title || '',
      text: message.share_text || '',
      image: message.share_image || null,
      url: shareUrl(message.share_type, message.share_id),
    } : null,
    reactions: message.reactions || [],
    online: presence.isOnline(message.sender_id),
    mine: message.sender_id === viewerId,
    html,
  };
}

/* ── inbox ────────────────────────────────────────────────────── */
/**
 * The chat is the floating dock now, on every page and on every screen
 * size, so the old page is retired and the dock is opened instead.
 */
router.get('/chat', (req, res) => res.redirect('/?chat=1'));

/** Someone to message - reuses the people search. */
router.get('/chat/new', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  return res.page('chat/new', {
    title: `New message - ${req.app.locals.config.siteName}`,
    active: 'chat',
    q,
    results: q ? users.search(q, { excludeId: req.user.id, limit: 40 }) : [],
    friendsList: friends.friends(req.user.id),
  });
});

/* ── start (or reopen) a conversation ─────────────────────────── */
router.post('/chat/with/:username', verifyCsrf, (req, res, next) => {
  const target = users.findByUsername(req.params.username);
  if (!target) return next();

  const conversation = chat.ensureConversation(req.user.id, target.id);
  if (!conversation) {
    req.flash('error', 'You cannot start a chat with yourself.');
    return res.redirect('/?chat=1');
  }
  return res.redirect(`/?chat=${conversation.id}`);
});

/* ── one thread ───────────────────────────────────────────────── */
router.get('/chat/:id', (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next();
  if (!chat.isMember(id, req.user.id)) {
    req.flash('error', 'That chat is not yours.');
    return res.redirect('/?chat=1');
  }
  if (!chat.summary(id, req.user.id)) return next();
  // The dock opens the thread itself.
  return res.redirect(`/?chat=${id}`);
});

/* ── polling endpoint: new messages only ──────────────────────── */
router.get('/chat/:id/messages', (req, res, next) => {
  const id = Number(req.params.id);
  if (!chat.isMember(id, req.user.id)) return jsonError(res, 'Not your chat.', 403);

  const after = Number.parseInt(req.query.after, 10) || 0;
  const messages = chat.messages(id, req.user.id, { afterId: after });
  chat.markRead(id, req.user.id);

  return Promise.all(messages.map((message) => renderMessage(res, message, req.user.id)))
    .then((payload) => {
      res.json({ ok: true, messages: payload, lastId: messages.at(-1)?.id ?? after });
    })
    .catch(next);
});

/* ── send ─────────────────────────────────────────────────────── */
router.post('/chat/:id/send', chatUpload, optimizeAs('chat'), verifyCsrf, (req, res, next) => {
  const id = Number(req.params.id);
  if (!chat.isMember(id, req.user.id)) {
    if (req.file) removeUpload(req.file.filename);
    return jsonError(res, 'Not your chat.', 403);
  }

  const body = cleanText(req.body.body ?? '', 4000);
  let mediaType = null;
  let mediaPath = null;
  let fileName = null;
  let fileSize = null;

  if (req.file) {
    mediaType = mediaKind(req.file.mimetype);
    if (!mediaType && isDocument(req.file)) {
      // A document (pdf, txt) travels as a file card.
      mediaPath = req.file.filename;
      fileName = (req.file.originalname || 'file').slice(0, 120);
      fileSize = req.file.size ?? null;
    } else if (!mediaType) {
      removeUpload(req.file.filename);
      if (wantsJson(req)) return jsonError(res, 'That file type is not supported.');
      req.flash('error', 'That file type is not supported.');
      return res.redirect(`/chat/${id}`);
    } else {
      mediaPath = req.file.filename;
    }
  }

  if (!body && !mediaPath) {
    if (wantsJson(req)) return jsonError(res, 'Write something or attach a file.');
    req.flash('error', 'Write something or attach a file.');
    return res.redirect(`/chat/${id}`);
  }

  // The message this one answers, if any.
  const parentId = Number(req.body.parent_id) || null;
  let parent = null;
  if (parentId) {
    parent = chat.messageById(parentId);
    if (!parent) {
      if (wantsJson(res)) return jsonError(res, 'That message is gone.');
      req.flash('error', 'That message is gone.');
      return res.redirect(`/chat/${id}`);
    }
  }

  const message = chat.sendMessage({
    conversationId: id,
    senderId: req.user.id,
    body: body || null,
    mediaType,
    mediaPath,
    fileName,
    fileSize,
    parentId: parent ? parentId : null,
    notifications,
  });

  // Real-time: notify other members via Socket.IO.
  try {
    const io = req.app.get('io');
    if (io) {
      const recipients = chat.memberIds(id).filter((uid) => uid !== req.user.id);
      const payload = { conversationId: id, messageId: message.id, senderId: req.user.id, sender: req.user.username };
      recipients.forEach((uid) => io.to(`user:${uid}`).emit('chat:message', payload));
      // Also notify the sender's other tabs.
      io.to(`user:${req.user.id}`).emit('chat:message', { ...payload, self: true });
    }
  } catch (e) {}

  // Push notifications for recipients. The global channel does not push
  // every message (that would be an alert for every driver); mentions are
  // handled separately. A muted thread never pushes.
  try {
    if (chat.kindOf(id) !== 'global') {
      const recipients = chat.memberIds(id).filter(
        (uid) => uid !== req.user.id && !chat.isMuted(id, uid),
      );
      recipients.forEach((uid) => {
        const lang = users.findById(uid)?.language || 'en';
        const fallback = mediaType === 'video'
          ? 'Sent a video'
          : mediaType === 'photo'
            ? 'Sent a photo'
            : 'Sent a file';
        pushToUser(uid, {
          title: translate(lang, 'New message from @{user}', { user: req.user.username }),
          body: body ? body.slice(0, 120) : translate(lang, fallback),
          url: `/?chat=${id}`,
          tag: `chat-${id}`,
          category: 'messages',
        });
      });
    }
  } catch (e) {}

  if (wantsJson(req)) {
    return renderMessage(res, message, req.user.id)
      .then((payload) => jsonOk(res, { message: payload }))
      .catch(next);
  }
  return res.redirect(`/chat/${id}`);
});

/* ── share a thing in a chat ───────────────────────────────────── */
/**
 * A driver hands a build, a post, a meetup, a part or a service to
 * another driver. The card is built from the database here, so it can
 * only point at a thing that really exists and that the sharer may
 * see. The chat is opened if there is not one yet.
 */
router.post('/share', requireAuth, verifyCsrf, async (req, res, next) => {
  try {
    const type = String(req.body.type ?? '').trim();
    const id = Number(req.body.id);
    const username = String(req.body.username ?? '').trim();
    const note = cleanText(req.body.note ?? '', 300);

    const card = shareCard(type, id, req.user.id);
    if (!card) {
      if (wantsJson(req)) return jsonError(res, 'That thing is gone.', 404);
      req.flash('error', 'That thing is gone.');
      return res.redirect(backTo(req, '/'));
    }

    // Sharing to the global channel.
    if (username === '__global__') {
      const channel = chat.globalChannel();
      if (!channel) {
        if (wantsJson(req)) return jsonError(res, 'The global channel is not available.', 404);
        req.flash('error', 'The global channel is not available.');
        return res.redirect(backTo(req, '/'));
      }
      const message = chat.sendMessage({
        conversationId: channel.id,
        senderId: req.user.id,
        body: note || null,
        share: card,
        notifications,
      });
      try {
        const io = req.app.get('io');
        if (io) {
          const payload = { conversationId: channel.id, messageId: message.id, senderId: req.user.id, sender: req.user.username };
          io.to(`user:${req.user.id}`).emit('chat:message', { ...payload, self: true });
        }
      } catch (e) {}
      if (wantsJson(req)) {
        const payload = await renderMessage(res, message, req.user.id);
        return jsonOk(res, { conversationId: channel.id, message: payload, share: card });
      }
      return res.redirect(`/?chat=${channel.id}`);
    }

    const target = users.findByUsername(username);
    if (!target) {
      if (wantsJson(req)) return jsonError(res, 'That driver is gone.', 404);
      req.flash('error', 'That driver is gone.');
      return res.redirect(backTo(req, '/'));
    }
    if (target.id === req.user.id) {
      if (wantsJson(req)) return jsonError(res, 'You cannot share with yourself.');
      req.flash('error', 'You cannot share with yourself.');
      return res.redirect(backTo(req, '/'));
    }

    const conversation = chat.ensureConversation(req.user.id, target.id);
    const message = chat.sendMessage({
      conversationId: conversation.id,
      senderId: req.user.id,
      body: note || null,
      share: card,
      notifications,
    });

    // Real-time: the other driver hears about it right away.
    try {
      const io = req.app.get('io');
      if (io) {
        const payload = { conversationId: conversation.id, messageId: message.id, senderId: req.user.id, sender: req.user.username };
        io.to(`user:${target.id}`).emit('chat:message', payload);
        io.to(`user:${req.user.id}`).emit('chat:message', { ...payload, self: true });
      }
    } catch (e) {}

    try {
      if (!chat.isMuted(conversation.id, target.id)) {
        const lang = users.findById(target.id)?.language || 'en';
        const what = translate(lang, SHARE_LABELS[card.type] || 'link');
        pushToUser(target.id, {
          title: translate(lang, 'New message from @{user}', { user: req.user.username }),
          body: note
            ? note.slice(0, 120)
            : translate(lang, 'Shared a {what}', { what }),
          url: `/?chat=${conversation.id}`,
          tag: `chat-${conversation.id}`,
          category: 'messages',
        });
      }
    } catch (e) {}

    if (wantsJson(req)) {
      const payload = await renderMessage(res, message, req.user.id);
      return jsonOk(res, { conversationId: conversation.id, message: payload, share: card });
    }
    return res.redirect(`/?chat=${conversation.id}`);
  } catch (error) {
    return next(error);
  }
});

/* ── delete a chat (for me) ───────────────────────────────────── */
router.post('/chat/:id/delete', verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  if (!chat.isMember(id, req.user.id)) {
    req.flash('error', 'That chat is not yours.');
    return res.redirect('/chat');
  }

  const result = chat.deleteForUser(id, req.user.id);
  if (result.blocked) {
    req.flash('error', 'The global channel cannot be deleted - it belongs to everyone.');
    return res.redirect(`/chat/${id}`);
  }
  req.flash('success', result.purged ? 'Chat deleted for both sides.' : 'Chat removed from your inbox. It will come back if they write again.');
  return res.redirect('/chat');
});

/* ── mute a chat for this member ──────────────────────────────── */
router.post('/chat/:id/mute', verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  if (!chat.isMember(id, req.user.id)) {
    if (wantsJson(req)) return jsonError(res, 'Not your chat.', 403);
    req.flash('error', 'That chat is not yours.');
    return res.redirect('/chat');
  }

  const muted = chat.toggleMute(id, req.user.id);
  if (wantsJson(req)) return jsonOk(res, { muted });
  req.flash('success', muted ? 'Chat muted.' : 'Chat unmuted.');
  return res.redirect(backTo(req, '/?chat=1'));
});

/* ── edit a message ──────────────────────────────────────────────── */
/**
 * The person who wrote a message can change it. The thread then shows
 * that it was edited, so nobody is misled about what was said.
 */
router.post('/chat/:id/message/:messageId/edit', requireAuth, verifyCsrf, (req, res, next) => {
  const id = Number(req.params.id);
  const messageId = Number(req.params.messageId);
  if (!chat.isMember(id, req.user.id)) return jsonError(res, 'Not your chat.', 403);
  const message = chat.editMessage({ messageId, userId: req.user.id, body: req.body.body ?? '' });
  if (!message) {
    if (wantsJson(req)) return jsonError(res, 'That message cannot be edited.');
    req.flash('error', 'That message cannot be edited.');
    return res.redirect(backTo(req, '/chat'));
  }
  chat.attachReactions([message], req.user.id);

  // Real-time: the others see the new text.
  try {
    const io = req.app.get('io');
    if (io) {
      const recipients = chat.memberIds(id).filter((uid) => uid !== req.user.id);
      const payload = { conversationId: id, messageId, body: message.body, senderId: req.user.id };
      recipients.forEach((uid) => io.to(`user:${uid}`).emit('chat:edit', payload));
      io.to(`user:${req.user.id}`).emit('chat:edit', { ...payload, self: true });
    }
  } catch (e) {}

  if (wantsJson(req)) {
    return renderMessage(res, message, req.user.id)
      .then((payload) => jsonOk(res, { message: payload }))
      .catch(next);
  }
  return res.redirect(backTo(req, '/chat'));
});

/* ── a reaction on a message ────────────────────────────────────── */
/**
 * Press an emoji on a message. Pressing the same emoji again takes the
 * reaction back. The other people in the chat see it right away.
 */
router.post('/chat/:id/message/:messageId/react', requireAuth, verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  const messageId = Number(req.params.messageId);
  if (!chat.isMember(id, req.user.id)) return jsonError(res, 'Not your chat.', 403);
  const message = chat.messageById(messageId);
  if (!message) return jsonError(res, 'That message is gone.', 404);

  const emoji = cleanText(req.body.emoji ?? '', 8);
  if (!emoji) return jsonError(res, 'Pick an emoji.', 400);
  const added = chat.toggleReaction({ messageId, userId: req.user.id, emoji });

  // Real-time: tell the others straight away.
  try {
    const io = req.app.get('io');
    if (io) {
      const recipients = chat.memberIds(id).filter((uid) => uid !== req.user.id);
      const payload = {
        conversationId: id,
        messageId,
        emoji,
        added,
        userId: req.user.id,
        username: req.user.username,
      };
      recipients.forEach((uid) => io.to(`user:${uid}`).emit('chat:reaction', payload));
      io.to(`user:${req.user.id}`).emit('chat:reaction', { ...payload, self: true });
    }
  } catch (e) {}

  if (wantsJson(req)) {
    const [withReactions] = chat.attachReactions([{ id: messageId }], req.user.id);
    return jsonOk(res, { ok: true, added, reactions: withReactions.reactions || [] });
  }
  return res.redirect(backTo(req, '/chat'));
});

/* ── admin: delete a single global chat message ────────────────── */
router.post('/chat/message/:messageId/delete', requireAdmin, verifyCsrf, (req, res) => {
  const messageId = Number(req.params.messageId);
  const ok = chat.deleteMessage(messageId, req.user.id, { asAdmin: true });
  if (!ok) {
    req.flash('error', 'Message not found.');
    return res.redirect(backTo(req, '/chat'));
  }
  req.flash('success', 'Message deleted.');
  return res.redirect(backTo(req, '/chat'));
});

/* ── admin: clear all global chat messages ─────────────────────── */
router.post('/chat/global/clear', requireAdmin, verifyCsrf, (req, res) => {
  const count = chat.clearGlobalChat(req.user.id);
  req.flash('success', `Cleared ${count} messages from the global channel.`);
  return res.redirect('/chat');
});

/* ── search messages in a conversation ─────────────────────────── */
router.get('/chat/:id/search', (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next();
  if (!chat.isMember(id, req.user.id)) {
    if (wantsJson(req)) return jsonError(res, 'Not your chat.', 403);
    req.flash('error', 'That chat is not yours.');
    return res.redirect('/chat');
  }
  const q = String(req.query.q ?? '').trim();
  if (!q) {
    if (wantsJson(req)) return jsonOk(res, { messages: [] });
    return res.redirect(`/chat/${id}`);
  }
  const results = chat.searchMessages(id, q, 40);
  if (wantsJson(req)) {
    return jsonOk(res, { messages: results });
  }
  return res.page('chat/search', {
    title: `Search in chat - ${req.app.locals.config.siteName}`,
    active: 'chat',
    conversation: chat.summary(id, req.user.id),
    q,
    results,
  });
});

export default router;
