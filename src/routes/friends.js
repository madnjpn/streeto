import express from 'express';
import * as friends from '../models/friends.js';
import * as pushLib from '../lib/push.js';
import * as users from '../models/users.js';
import * as chat from '../models/chat.js';
import * as notifications from '../models/notifications.js';
import { requireAuth } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { backTo, wantsJson, jsonOk, jsonError, pagination } from '../lib/http.js';

const router = express.Router();

/* ── friends hub ──────────────────────────────────────────────── */
router.get('/friends', requireAuth, (req, res) =>
  res.page('friends/index', {
    title: `Friends - ${req.app.locals.config.siteName}`,
    active: 'friends',
    friendsList: friends.friends(req.user.id),
    incoming: friends.incomingRequests(req.user.id),
    outgoing: friends.outgoingRequests(req.user.id),
    suggestions: users.suggestions(req.user.id, 12),
  }),
);

/* ── find drivers (people search) ──────────────────────────────── */
router.get('/people', requireAuth, (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const results = q ? users.search(q, { excludeId: req.user.id, limit: 40 }) : [];

  const shaped = results.map((person) => ({
    ...person,
    relationship: friends.relationship(req.user.id, person.id),
  }));

  // Your own group is always listed, whatever the search says - a friend you
  // have to search for is a friend you cannot find.
  const friendsList = friends.friends(req.user.id).map((person) => ({
    ...person,
    relationship: { status: 'accepted', direction: null, id: null },
  }));

  // Without a search the page lists everybody, not only the twelve
  // suggestions - the network should be visible in full.
  const { page, perPage, offset } = pagination(req.query, { perPage: 40 });
  const directory = q ? [] : users.directory({ excludeId: req.user.id, limit: perPage, offset });
  const directoryTotal = q ? 0 : users.directoryCount(req.user.id);

  return res.page('friends/people', {
    title: q ? `Search: ${q} - ${req.app.locals.config.siteName}` : `Find drivers - ${req.app.locals.config.siteName}`,
    active: 'people',
    q,
    results: shaped,
    friendsList,
    suggestions: users.suggestions(req.user.id, 12),
    directory,
    directoryTotal,
    page,
    hasMore: offset + directory.length < directoryTotal,
    baseQs: 'q=' + encodeURIComponent(q),
  });
});

/* ── send a request ───────────────────────────────────────────── */
router.post('/friends/request/:username', requireAuth, verifyCsrf, (req, res, next) => {
  const target = users.findByUsername(req.params.username);
  if (!target) return next();

  const result = friends.sendRequest(req.user.id, target.id);
  if (!result.ok) {
    if (wantsJson(req)) return jsonError(res, result.error);
    req.flash('error', result.error);
    return res.redirect(backTo(req, '/people'));
  }

  if (!result.accepted) {
    notifications.notify({
      userId: target.id,
      actorId: req.user.id,
      type: 'friend_request',
      entityId: result.id,
      url: '/friends',
      text: 'sent you a friend request',
    });
    pushLib.sendToUser(target.id, { title: `Friend request from @${req.user.username}`, body: 'Tap to accept or decline.', url: '/friends', tag: 'friend-request' });
  } else {
    notifications.notify({
      userId: target.id,
      actorId: req.user.id,
      type: 'friend_accept',
      entityId: req.user.id,
      url: `/u/${req.user.username}`,
      text: 'accepted your friend request',
    });
    pushLib.sendToUser(target.id, { title: `@${req.user.username} accepted your request`, body: 'You are now friends.', url: `/u/${req.user.username}`, tag: 'friend-accept' });
  }

  if (wantsJson(req)) {
    return jsonOk(res, {
      accepted: Boolean(result.accepted),
      id: result.id,
      label: result.accepted ? req.t('Friends') : req.t('Request sent'),
    });
  }

  req.flash('success', result.accepted
    ? req.t('You and @{user} are now friends.', { user: target.username })
    : req.t('Friend request sent to @{user}.', { user: target.username }));
  return res.redirect(backTo(req, '/people'));
});

/* ── accept / decline / cancel / unfriend ─────────────────────── */
router.post('/friends/accept/:id', requireAuth, verifyCsrf, (req, res) => {
  const request = friends.incomingRequests(req.user.id).find((row) => row.id === Number(req.params.id));
  const accepted = friends.acceptRequest(Number(req.params.id), req.user.id);

  if (accepted) {
    notifications.notify({
      userId: accepted.requester_id,
      actorId: req.user.id,
      type: 'friend_accept',
      entityId: req.user.id,
      url: `/u/${req.user.username}`,
      text: 'accepted your friend request',
    });
    const name = request ? `@${request.username}` : 'them';
    req.flash('success', 'You and {name} are now friends.', { name });
  } else {
    req.flash('error', 'That request is no longer available.');
  }

  if (wantsJson(req)) return jsonOk(res, { accepted: Boolean(accepted) });
  return res.redirect(backTo(req, '/friends'));
});

router.post('/friends/decline/:id', requireAuth, verifyCsrf, (req, res) => {
  const declined = friends.declineRequest(Number(req.params.id), req.user.id);
  if (wantsJson(req)) return jsonOk(res, { declined });
  if (declined) req.flash('success', 'Request declined.');
  return res.redirect(backTo(req, '/friends'));
});

router.post('/friends/cancel/:id', requireAuth, verifyCsrf, (req, res) => {
  const cancelled = friends.cancelRequest(Number(req.params.id), req.user.id);
  if (wantsJson(req)) return jsonOk(res, { cancelled });
  if (cancelled) req.flash('success', 'Request withdrawn.');
  return res.redirect(backTo(req, '/friends'));
});

router.post('/friends/remove/:username', requireAuth, verifyCsrf, (req, res, next) => {
  const target = users.findByUsername(req.params.username);
  if (!target) return next();

  const removed = friends.removeFriend(target.id, req.user.id);
  if (wantsJson(req)) return jsonOk(res, { removed });
  if (removed) req.flash('success', 'Removed @{user} from your group.', { user: target.username });
  else req.flash('error', 'You are not friends.');
  return res.redirect(backTo(req, '/friends'));
});

/* ── start a chat straight from a friend card ─────────────────── */
router.post('/friends/message/:username', requireAuth, verifyCsrf, (req, res, next) => {
  const target = users.findByUsername(req.params.username);
  if (!target) return next();

  const conversation = chat.ensureConversation(req.user.id, target.id);
  if (!conversation) {
    req.flash('error', 'You cannot message yourself.');
    return res.redirect('/friends');
  }
  // The chat is the floating dock now - open it straight into the thread.
  return res.redirect(`/?chat=${conversation.id}`);
});

export default router;
