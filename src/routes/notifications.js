import express from 'express';
import * as notifications from '../models/notifications.js';
import { requireAuth } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { backTo, wantsJson, jsonOk } from '../lib/http.js';

const router = express.Router();

/* ── activity feed ────────────────────────────────────────────── */
router.get('/notifications', requireAuth, (req, res) => {
  const items = notifications.recent(req.user.id, 60);
  const hadUnread = items.some((item) => !item.read_at);
  notifications.markAllRead(req.user.id);

  return res.page('notifications/index', {
    title: `Activity - ${req.app.locals.config.siteName}`,
    active: 'activity',
    items,
    hadUnread,
  });
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
