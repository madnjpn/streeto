import express from 'express';
import * as notifications from '../models/notifications.js';
import { requireAuth } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { backTo, wantsJson, jsonOk } from '../lib/http.js';
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_KEYS } from '../lib/notification-prefs.js';

const router = express.Router();

const FILTERS = new Set(['all', 'unread']);
const CATEGORIES = new Set(NOTIFICATION_CATEGORY_KEYS);

/* ── activity feed ────────────────────────────────────────────── */
router.get('/notifications', requireAuth, (req, res) => {
  const filter = FILTERS.has(req.query.filter) ? req.query.filter : 'all';
  const category = CATEGORIES.has(req.query.type) ? req.query.type : '';
  const items = notifications.recent(req.user.id, {
    limit: 60,
    unreadOnly: filter === 'unread',
    category: category || null,
  });

  return res.page('notifications/index', {
    title: `Activity - ${req.app.locals.config.siteName}`,
    active: 'activity',
    items,
    filter,
    category,
    unread: notifications.unreadCount(req.user.id),
    categories: NOTIFICATION_CATEGORIES,
  });
});

/** Opening one item marks it read, then sends the member to the real thing. */
router.get('/notifications/open/:id', requireAuth, (req, res) => {
  const item = notifications.byId(req.user.id, Number(req.params.id));
  if (!item) return res.redirect('/notifications');
  notifications.markRead(req.user.id, item.id);
  const target = String(item.url || '');
  return res.redirect(target.startsWith('/') && !target.startsWith('//') ? target : '/notifications');
});

router.post('/notifications/read', requireAuth, verifyCsrf, (req, res) => {
  notifications.markAllRead(req.user.id);
  if (wantsJson(req)) return jsonOk(res);
  return res.redirect(backTo(req, '/notifications'));
});

router.post('/notifications/clear', requireAuth, verifyCsrf, (req, res) => {
  notifications.clearAll(req.user.id);
  req.flash('success', 'Activity cleared.');
  return res.redirect('/notifications');
});

/** Small badge counter polled by the client. */
router.get('/notifications/count', requireAuth, (req, res) =>
  jsonOk(res, { unread: notifications.unreadCount(req.user.id) }),
);

export default router;
