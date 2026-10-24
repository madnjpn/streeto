import express from 'express';
import * as users from '../models/users.js';
import * as posts from '../models/posts.js';
import * as friends from '../models/friends.js';
import * as groups from '../models/groups.js';
import * as meetups from '../models/meetups.js';
import * as maintenance from '../models/maintenance.js';
import { requireAuth } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { avatarUpload, removeUpload, optimizeAs } from '../lib/uploads.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { checkPassword, cleanText, USERNAME_MAX } from '../lib/validate.js';
import { pagination, backTo } from '../lib/http.js';
import { CHANGELOG } from '../lib/changelog.js';

const router = express.Router();

/* ── public profile ───────────────────────────────────────────── */
router.get('/u/:username', (req, res, next) => {
  const profile = users.findByUsername(req.params.username);
  if (!profile) return next();

  const isMe = req.user?.id === profile.id;
  const relationship = req.user ? friends.relationship(req.user.id, profile.id) : { status: null };

  const { page, perPage, offset } = pagination(req.query, { perPage: 10 });
  const items = posts.feed({
    scope: 'user',
    viewerId: req.user?.id ?? 0,
    userId: profile.id,
    limit: perPage,
    offset,
  });

  return res.page('profile/show', {
    title: `${profile.display_name || profile.username} (@${profile.username}) - ${req.app.locals.config.siteName}`,
    active: 'people',
    profile,
    isMe,
    relationship,
    items,
    page,
    hasMore: items.length === perPage,
    stats: users.stats(profile.id),
    friendCount: friends.friendCount(profile.id),
    mutual: req.user && !isMe ? friends.mutualCount(req.user.id, profile.id) : 0,
    friendsPreview: friends.friends(profile.id).slice(0, 9),
    profileGroups: groups
      .myGroups(profile.id)
      .filter((group) => group.status === 'active' && group.privacy !== 'invite')
      .slice(0, 6),
    hostedMeetups: meetups.list({ scope: 'mine', viewerId: profile.id, limit: 4 }),
    profileServices: maintenance.feed({ scope: 'user', userId: profile.id, limit: 6 }),
  });
});

/* ── settings ─────────────────────────────────────────────────── */
router.get('/settings', requireAuth, (req, res) =>
  res.page('profile/settings', {
    title: `Settings - ${req.app.locals.config.siteName}`,
    active: 'settings',
    errors: {},
    values: {
      display_name: req.user.display_name ?? '',
      bio: req.user.bio ?? '',
      car: req.user.car ?? '',
      city: req.user.city ?? '',
      username: req.user.username,
      email: req.user.email,
      provider_name: req.user.provider_name ?? '',
      is_provider: Boolean(req.user.is_provider),
    },
    maxUsername: USERNAME_MAX,
    changelog: CHANGELOG,
    notifyPrefs: users.notificationPrefs(req.user.id),
  }),
);

router.post('/settings', requireAuth, avatarUpload, optimizeAs('avatar'), verifyCsrf, (req, res) => {
  const values = {
    display_name: cleanText(req.body.display_name ?? '', 40),
    bio: cleanText(req.body.bio ?? '', 600),
    car: cleanText(req.body.car ?? '', 80),
    city: cleanText(req.body.city ?? '', 80),
  };

  let avatar = null;
  if (req.file) {
    const isImage = req.file.mimetype.startsWith('image/');
    if (!isImage) {
      removeUpload(req.file.filename);
      req.flash('error', 'Your avatar must be an image.');
      return res.redirect('/settings');
    }
    avatar = req.file.filename;
    if (req.user.avatar) removeUpload(req.user.avatar);
  }

  users.updateProfile(req.user.id, { ...values, avatar });

  // Ticking the box means "I want to provide services" - it lets the member
  // claim a listing. The business name is never typed in by hand: it always
  // follows the listings the member owns.
  const isProvider =
    req.body.is_provider === '1' || req.body.is_provider === 'on' || req.body.is_provider === 'true';
  if (isProvider) {
    maintenance.setProviderNameFromListings(req.user.id);
  }
  users.setProvider(req.user.id, { isProvider });

  req.flash('success', 'Profile updated.');
  return res.redirect('/settings');
});

router.post('/settings/letters', requireAuth, verifyCsrf, (req, res) => {
  const digest = req.body.mail_digest === '1' || req.body.mail_digest === 'on';
  const pti = req.body.mail_pti === '1' || req.body.mail_pti === 'on';
  users.setMailPrefs(req.user.id, { digest, pti });
  req.flash('success', 'Letter settings saved.');
  return res.redirect('/settings');
});

/** Push categories are independent switches; the activity feed is not filtered. */
router.post('/settings/notifications', requireAuth, verifyCsrf, (req, res) => {
  const prefs = {};
  for (const key of ['messages', 'social', 'groups', 'meetups', 'builds', 'services']) {
    const value = req.body[`notify_${key}`];
    prefs[key] = value === '1' || value === 'on';
  }
  users.setNotificationPrefs(req.user.id, prefs);
  req.flash('success', 'Notification settings saved.');
  return res.redirect('/settings#notifications');
});

router.post('/settings/password', requireAuth, verifyCsrf, async (req, res) => {
  const current = String(req.body.current_password ?? '');
  const next = String(req.body.new_password ?? '');
  const confirm = String(req.body.confirm_password ?? '');

  const record = users.findWithHash(req.user.username);
  if (!record || !(await verifyPassword(current, record.password_hash))) {
    req.flash('error', 'Your current password is not right.');
    return res.redirect('/settings');
  }

  const check = checkPassword(next, { username: req.user.username });
  if (!check.ok) {
    req.flash('error', check.error);
    return res.redirect('/settings');
  }
  if (next !== confirm) {
    req.flash('error', 'The new passwords do not match.');
    return res.redirect('/settings');
  }

  users.updatePassword(req.user.id, await hashPassword(next));
  req.flash('success', 'Password changed.');
  return res.redirect('/settings');
});

/* ── delete account ───────────────────────────────────────────── */
router.post('/settings/delete', requireAuth, verifyCsrf, async (req, res) => {
  const record = users.findWithHash(req.user.username);
  const password = String(req.body.password ?? '');

  if (!record || !(await verifyPassword(password, record.password_hash))) {
    req.flash('error', 'Password is required to delete your account.');
    return res.redirect('/settings');
  }

  if (req.user.avatar) removeUpload(req.user.avatar);
  const { run } = await import('../db.js');
  run('DELETE FROM users WHERE id = ?', req.user.id);

  req.session.destroy(() => {
    res.clearCookie('streeto.sid', { path: '/' });
    res.redirect('/register');
  });
});

export default router;
