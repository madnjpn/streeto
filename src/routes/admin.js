import path from 'node:path';
import express from 'express';
import config from '../config.js';
import { all, count } from '../db.js';
import * as users from '../models/users.js';
import * as posts from '../models/posts.js';
import * as builds from '../models/builds.js';
import * as meetups from '../models/meetups.js';
import * as groups from '../models/groups.js';
import * as reports from '../models/reports.js';
import * as partners from '../models/partners.js';
import * as maintenance from '../models/maintenance.js';
import * as notifications from '../models/notifications.js';
import * as translations from '../models/translations.js';
import * as howitworks from '../models/howitworks.js';
import { usedKeys, manualKeys } from '../lib/used-keys.js';
import { ICON_NAMES } from '../lib/icons.js';
import * as backup from '../lib/backup.js';
import { removeUpload, fontUpload, partnerUpload, validateFont, uploadUrl, fontCssFormat } from '../lib/uploads.js';
import { prepareLogo, nameFromLogoFile, cleanPartnerUrl } from '../lib/logos.js';
import { removeUserFolder } from '../lib/upload-paths.js';
import { sendPtiReminders, sendDigests } from '../lib/mail-jobs.js';
import { requireAdmin } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { wantsJson, jsonOk, jsonError, fail } from '../lib/http.js';
import { latinFonts, georgianFonts } from './pages.js';
import { DEFAULT_LATIN, DEFAULT_GEORGIAN, getFont, setFontSlot, listCustomFonts, addCustomFont, removeCustomFont } from '../models/appearance.js';

const router = express.Router();

/* /admin only makes sense behind the admin flag. */
router.use('/admin', requireAdmin);

const TABS = new Set(['users', 'content', 'backups', 'reports', 'appearance', 'partners']);

/** Recent posts, with the bits the console needs to identify them. */
const recentPosts = (limit = 40) =>
  all(
    `SELECT p.id, p.body, p.post_type, p.media_type, p.media_path, p.group_id, p.created_at,
            u.username, u.display_name, u.avatar,
            (SELECT COUNT(*) FROM post_likes pl WHERE pl.post_id = p.id) AS like_count,
            (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
       FROM posts p JOIN users u ON u.id = p.user_id
      ORDER BY p.created_at DESC LIMIT ?`,
    limit,
  );

/** Recent meetups, soonest and newest first. */
const recentMeetups = (limit = 40) =>
  all(
    `SELECT m.id, m.title, m.place_name, m.starts_at, m.privacy, m.created_at,
            u.username AS host_username, u.display_name AS host_display_name, u.avatar AS host_avatar,
            (SELECT COUNT(*) FROM meetup_attendees a WHERE a.meetup_id = m.id AND a.status IN ('going','invited')) AS going_count
       FROM meetups m JOIN users u ON u.id = m.host_id
      ORDER BY m.created_at DESC LIMIT ?`,
    limit,
  );

/** Recent groups, newest first. */
const recentGroups = (limit = 40) =>
  all(
    `SELECT g.id, g.name, g.slug, g.privacy, g.created_at,
            u.username AS owner_username, u.display_name AS owner_display_name,
            (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id AND gm.status = 'active') AS member_count
       FROM groups g JOIN users u ON u.id = g.owner_id
      ORDER BY g.created_at DESC LIMIT ?`,
    limit,
  );

/** Recent builds, newest first. */
const recentBuilds = (limit = 40) =>
  all(
    `SELECT b.id, b.title, b.make, b.model, b.visibility, b.created_at,
            u.username, u.display_name,
            (SELECT COUNT(*) FROM build_votes bv WHERE bv.build_id = b.id) AS vote_count
       FROM builds b JOIN users u ON u.id = b.user_id
      ORDER BY b.created_at DESC LIMIT ?`,
    limit,
  );

/* ── dashboard ────────────────────────────────────────────────── */
router.get('/admin', (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const tab = TABS.has(req.query.tab) ? req.query.tab : 'users';

  return res.page('admin/index', {
    title: `Admin - ${config.siteName}`,
    active: 'admin',
    wide: true,
    pageScripts: [`/assets/${res.locals.assetStamp}/js/admin.js`],
    tab,
    q,
    members: users.adminList({ q, limit: 200 }),
    adminCount: users.adminCount(),
    posts: recentPosts(),
    meetups: recentMeetups(),
    groups: recentGroups(),
    builds: recentBuilds(),
    backups: backup.listBackups(),
    reports: reports.openReports(),
    pendingClaims: maintenance.pendingClaims().length,
    backupDir: backup.BACKUP_DIR,
    backupIntervalHours: Math.round(config.backupIntervalMs / 3600000),
    backupKeep: config.backupKeep,
    stats: {
      drivers: count('users'),
      admins: users.adminCount(),
      posts: count('posts'),
      meetups: count('meetups'),
      groups: count('groups'),
      builds: count('builds'),
      messages: count('messages'),
    },
    latinFonts,
    georgianFonts,
    currentFont: getFont(),
    customFonts: listCustomFonts().map((f) => ({ ...f, url: uploadUrl(f.filename) })),
  });
});

/* ── role management ──────────────────────────────────────────── */
router.post('/admin/users/:id/admin', verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  const target = users.findById(id);
  if (!target) return fail(req, res, 'That driver no longer exists.');

  const grant = req.body.admin === '1' || req.body.action === 'grant';
  if (!grant && target.is_admin && users.adminCount() <= 1) {
    return fail(req, res, 'There has to be at least one admin.');
  }

  users.setAdmin(id, grant);
  req.flash(
    'success',
    grant
      ? req.t('@{user} is now an admin.', { user: target.username })
      : req.t('@{user} is back to a normal driver.', { user: target.username }),
  );
  return back(req, res, 'users');
});

router.post('/admin/users/:id/transfer', verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  const target = users.findById(id);
  if (!target) return fail(req, res, 'That driver no longer exists.');
  if (id === req.user.id) return fail(req, res, 'You already hold the admin role.');

  users.setAdmin(id, true);
  users.setAdmin(req.user.id, false);
  req.flash('success', 'Admin handed over to @{user}.', { user: target.username });
  // Access is gone after this request, so leave the console entirely.
  return res.redirect('/');
});

router.post('/admin/users/:id/delete', verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  const target = users.findById(id);
  if (!target) return fail(req, res, 'That driver no longer exists.');
  if (id === req.user.id) return fail(req, res, 'You cannot delete your own account here. Use Settings.');
  if (target.is_admin && users.adminCount() <= 1) {
    return fail(req, res, 'There has to be at least one admin.');
  }

  // Collect media first - the rows that point at it are about to vanish.
  const files = users.uploadsFor(id);
  users.removeUser(id);
  for (const file of files) removeUpload(file);
  // And the folder that driver kept their pictures in.
  removeUserFolder(id);

  req.flash('success', '@{user} and everything they posted are gone.', { user: target.username });
  return back(req, res, 'users');
});

/* ── content moderation ───────────────────────────────────────── */
router.post('/admin/posts/:id/delete', verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  const ok = posts.remove(id, req.user.id, { asModerator: true });
  req.flash(ok ? 'success' : 'error', ok ? 'Post removed.' : 'That post no longer exists.');
  return back(req, res, 'content');
});

router.post('/admin/meetups/:id/delete', verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  const meetup = meetups.byId(id);
  if (meetup) meetups.remove(id);
  req.flash(meetup ? 'success' : 'error', meetup ? 'Meetup removed.' : 'That meetup no longer exists.');
  return back(req, res, 'content');
});

router.post('/admin/groups/:id/delete', verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  const group = groups.byId(id);
  if (group) {
    if (group.avatar) removeUpload(group.avatar);
    groups.deleteGroup(id);
  }
  req.flash(group ? 'success' : 'error', group ? 'Group removed.' : 'That group no longer exists.');
  return back(req, res, 'content');
});

router.post('/admin/builds/:id/delete', verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  const ok = builds.removeBuild(id, req.user.id, { asModerator: true });
  req.flash(ok ? 'success' : 'error', ok ? 'Build removed.' : 'That build no longer exists.');
  return back(req, res, 'content');
});

/* ── the letters the site sends on its own ──────────────────────── */
router.post('/admin/mail-jobs', requireAdmin, verifyCsrf, async (req, res) => {
  const reminders = await sendPtiReminders();
  const digests = await sendDigests();
  const message = `Letters sent: ${reminders} reminder(s), ${digests} digest(s).`;
  if (wantsJson(req)) return jsonOk(res, { reminders, digests, ok: true });
  req.flash('success', message);
  return res.redirect('/admin');
});

/* ── database backups ─────────────────────────────────────────── */
router.post('/admin/backups', verifyCsrf, (req, res) => {
  try {
    const info = backup.createBackup({ auto: false });
    if (wantsJson(req)) return jsonOk(res, info);
    req.flash('success', 'Backup created: {name}.', { name: info.name });
  } catch (error) {
    // The exception can carry a file path or a SQLite message - it belongs in
    // the server log, not on the admin's screen.
    console.error('[admin] backup failed:', error.message);
    if (wantsJson(req)) return jsonError(res, req.t('The backup could not be created.'), error.status || 500);
    req.flash('error', 'The backup could not be created.');
  }
  return back(req, res, 'backups');
});

router.post('/admin/backups/:name/restore', verifyCsrf, (req, res) => {
  try {
    backup.restoreBackup(req.params.name);
    // The snapshot replaced the dictionary and the manual, so the live
    // copy in memory has to be read again.
    translations.init();
    howitworks.seed();
    req.flash(
      'success',
      req.t('Database restored from {name}. You may need to log in again if that snapshot predates your account.', {
        name: req.params.name,
      }),
    );
  } catch (error) {
    console.error('[admin] restore failed:', error.message);
    req.flash('error', 'That snapshot could not be restored.');
  }
  return back(req, res, 'backups');
});

router.post('/admin/backups/:name/delete', verifyCsrf, (req, res) => {
  try {
    backup.removeBackup(req.params.name);
    req.flash('success', 'Backup deleted.');
  } catch (error) {
    console.error('[admin] backup delete failed:', error.message);
    req.flash('error', 'That snapshot could not be deleted.');
  }
  return back(req, res, 'backups');
});

router.get('/admin/backups/:name/download', (req, res) => {
  const file = backup.resolveBackup(req.params.name);
  if (!file) return res.status(404).send('Backup not found.');
  res.setHeader('Content-Type', 'application/vnd.sqlite3');
  return res.download(file, path.basename(file));
});

/* ── shared helpers ───────────────────────────────────────────── */
function back(req, res, tab) {
  if (wantsJson(req)) return jsonOk(res, { ok: true });
  return res.redirect(`/admin?tab=${tab}`);
}

router.post('/admin/reports/:id/resolve', verifyCsrf, (req, res) => {
  reports.resolve(Number(req.params.id), req.user.id, req.body.action === 'dismiss' ? 'dismissed' : 'resolved');
  req.flash('success', 'Report updated.');
  return res.redirect('/admin?tab=reports');
});

/* ── set the font for one script ───────────────────────────────── */
const GENERICS = new Set([
  'system-ui', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy',
  '-apple-system', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded',
]);

/** Drop generic families so they can't shadow the other script's font. */
const cleanStack = (value) =>
  String(value || '')
    .replace(/["<>{};\\]/g, '')
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token && !GENERICS.has(token.replace(/^['"]|['"]$/g, '').toLowerCase()))
    .slice(0, 8)
    .join(', ');

const asFamily = (value, fallback) =>
  String(value || fallback).replace(/["'<>{};\\]/g, '').slice(0, 120);
const asText = (value, fallback) =>
  String(value || fallback).replace(/["'<>{}]/g, '').slice(0, 120);

router.post('/admin/font', requireAdmin, verifyCsrf, (req, res) => {
  const slot = req.body?.slot === 'georgian' ? 'georgian' : req.body?.slot === 'latin' ? 'latin' : null;
  const font = req.body?.font;
  if (!slot || !font) return fail(req, res, 'Invalid font data');

  let chosen;
  if (slot === 'georgian') {
    const family = asFamily(font.family || font.heading || font.body, DEFAULT_GEORGIAN.family);
    if (!family) return fail(req, res, 'Invalid font data');
    chosen = {
      name: asText(font.name, family),
      family,
      description: asText(font.description, ''),
    };
  } else {
    const heading = asFamily(font.heading, DEFAULT_LATIN.heading);
    const body = asFamily(font.body, DEFAULT_LATIN.body);
    if (!heading || !body) return fail(req, res, 'Invalid font data');
    chosen = {
      name: asText(font.name, 'Custom choice'),
      heading,
      headingFallback: cleanStack(font.headingFallback),
      body,
      bodyFallback: cleanStack(font.bodyFallback),
      description: asText(font.description, ''),
    };
    if (font.family) chosen.family = asFamily(font.family, '');
    if (font.weight) chosen.weight = asText(font.weight, '400');
  }

  setFontSlot(slot, chosen);

  req.flash('success', slot === 'georgian' ? 'Georgian font updated.' : 'English font updated.');
  if (wantsJson(req)) return jsonOk(res, { slot, font: chosen });
  return res.redirect('/admin?tab=appearance');
});

/* ── upload custom font ────────────────────────────────────────── */
router.post('/admin/font/upload', requireAdmin, fontUpload, verifyCsrf, validateFont, (req, res, next) => {
  const file = req.file;
  if (!file) {
    const error = new Error('No font file uploaded.');
    error.status = 400;
    error.code = 'UNSUPPORTED_MEDIA_TYPE';
    return next(error);
  }

  // Validate the metadata that ends up in the @font-face rule.
  const weight = /^(100|200|300|400|500|600|700|800|900)$/.test(String(req.body.weight))
    ? String(req.body.weight)
    : '400';
  const style = req.body.style === 'italic' ? 'italic' : 'normal';
  const lang = ['latin', 'georgian', 'all'].includes(req.body.lang) ? req.body.lang : 'all';
  const usage = ['heading', 'body', 'both'].includes(req.body.usage) ? req.body.usage : 'both';
  const family = String(req.body.family || path.parse(file.originalname).name)
    .replace(/[\r\n<>{}"';]/g, '')
    .replace(/\.(woff2?|ttf|otf|eot)$/i, '')
    .trim()
    .slice(0, 60) || path.parse(file.originalname).name;

  const row = addCustomFont({
    filename: file.filename,
    originalName: file.originalname,
    mimetype: file.mimetype,
    format: fontCssFormat(file.mimetype),
    size: file.size,
    family,
    weight,
    style,
    lang,
    usage,
  });

  req.flash('success', 'Font uploaded successfully!');
  if (wantsJson(req)) return jsonOk(res, { font: { ...row, url: uploadUrl(row.filename) } });
  return res.redirect('/admin?tab=appearance');
});

/* ── delete custom font ────────────────────────────────────────── */
router.post('/admin/font/delete', requireAdmin, verifyCsrf, (req, res) => {
  const id = Number(req.body.fontId ?? req.body.fontIndex);
  if (!Number.isFinite(id) || id < 0) return fail(req, res, 'Invalid font id');

  const row = removeCustomFont(id);
  if (!row) return fail(req, res, 'Font not found');
  removeUpload(row.filename);

  req.flash('success', 'Font deleted.');
  if (wantsJson(req)) return jsonOk(res, { deleted: id });
  return res.redirect('/admin?tab=appearance');
});

/* ── partners management ───────────────────────────────────────── */
/* The living style guide: one page that shows the components every other
   page must use. It is admin-only, so it never becomes public content. */
router.get('/admin/style-guide', (req, res) =>
  res.page('admin/style-guide', {
    title: `UI system - ${config.siteName}`,
    active: 'admin',
    wide: true,
  }),
);

router.get('/admin/partners', requireAdmin, (req, res) => {
  return res.page('admin/partners', {
    title: `Partners - ${config.siteName}`,
    active: 'admin',
    wide: true,
    pageScripts: [`/assets/${res.locals.assetStamp}/js/admin.js`],
    partners: partners.listAll(),
  });
});

router.post('/admin/partners/new', requireAdmin, partnerUpload, verifyCsrf, async (req, res, next) => {
  const file = req.file;
  if (!file) {
    const error = new Error('No logo file uploaded.');
    error.status = 400;
    return next(error);
  }
  // The logo is all the admin has to give: the name comes from the file.
  const name = nameFromLogoFile(file.originalname);
  const baseSlug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'partner';
  let slug = baseSlug;
  // Ensure slug is unique by appending a counter
  for (let n = 0; partners.bySlug(slug); n++) {
    slug = baseSlug.slice(0, 36) + '-' + (n + 1).toString(36);
  }
  // A link is welcome, but not needed - it can be added later.
  const url = cleanPartnerUrl(req.body.url);

  // The logo is trimmed and measured, so the wall can show it big.
  let logo;
  try {
    logo = await prepareLogo(file.path);
  } catch (error) {
    return next(error);
  }

  partners.create({
    name,
    slug,
    logoPath: logo.file,
    url,
    logoW: logo.width,
    logoH: logo.height,
    logoPlate: logo.plate,
  });
  req.flash('success', 'Partner added.');
  return res.redirect('/admin/partners');
});

router.post('/admin/partners/:id', requireAdmin, partnerUpload, verifyCsrf, async (req, res, next) => {
  const id = Number(req.params.id);
  const p = partners.byId(id);
  if (!p) return fail(req, res, 'Partner not found');
  const name = String(req.body.name || '').trim();
  let slug = String(req.body.slug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
  // The link is optional, and it can be filled in later.
  const rawUrl = String(req.body.url || '').trim();
  const url = cleanPartnerUrl(rawUrl);
  if (rawUrl && !url) return fail(req, res, 'That does not look like a web address.');
  const position = Number.isFinite(Number(req.body.position)) ? Number(req.body.position) : p.position;
  const isActive = req.body.is_active ? 1 : 0;
  if (!name) return fail(req, res, 'Name is required.');
  // Auto-generate slug from name if not provided
  if (!slug) {
    slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'partner';
  }
  if (slug !== p.slug && partners.bySlug(slug)) return fail(req, res, 'A partner with that slug already exists.');
  const data = { name, slug, url, position, isActive };
  if (req.file) {
    // The new logo is trimmed and measured before the old one goes.
    let logo;
    try {
      logo = await prepareLogo(req.file.path);
    } catch (error) {
      return next(error);
    }
    removeUpload(p.logo_path);
    data.logoPath = logo.file;
    data.logoW = logo.width;
    data.logoH = logo.height;
    data.logoPlate = logo.plate;
  }
  partners.update(id, data);
  req.flash('success', 'Partner updated.');
  return res.redirect('/admin/partners');
});

router.post('/admin/partners/:id/delete', requireAdmin, verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  partners.remove(id);
  req.flash('success', 'Partner deleted.');
  return res.redirect('/admin/partners');
});

/* ── translations ──────────────────────────────────────────────── */
/**
 * The Georgian dictionary, editable while the site is running. The
 * English source string is the key - it is what the templates ask for -
 * and the right-hand field holds the Georgian.
 */
router.get('/admin/translations', requireAdmin, (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const only = req.query.only === 'missing' ? 'missing' : '';
  const used = usedKeys();
  const all = translations.list('ka', { q, only, limit: 4000 });
  // The whole site in one list - the manual included, because its
  // wording is part of the site as well.
  const rows = all.map((row) => ({ ...row, used: used.has(row.key) }));
  return res.page('admin/translations', {
    title: `Translations - ${config.siteName}`,
    active: 'admin',
    wide: true,
    pageScripts: [`/assets/${res.locals.assetStamp}/js/admin-translations.js`],
    q,
    only,
    rows,
    total: translations.countFor('ka'),
    missing: translations.missingCount('ka'),
    unusedCount: all.filter((row) => !used.has(row.key)).length,
  });
});

/**
 * Read the code again and pick up any wording it has introduced. This
 * also runs on every boot, so a new feature never leaves a string
 * stranded in English without an admin noticing.
 *
 * The leftovers go at the same time - usually a message that was copied
 * out of the running site and pasted into the wrong field by mistake,
 * which puts a real name into the key.
 */
router.post('/admin/translations/sync', requireAdmin, verifyCsrf, (req, res) => {
  const result = translations.syncWithCode();
  const removed = translations.removeUnused(usedKeys());
  if (wantsJson(req)) return jsonOk(res, { ...result, removed });
  req.flash('success', 'Checked the code - {n} new string(s) found, {m} leftover(s) removed.', {
    n: result.added,
    m: removed,
  });
  return res.redirect('/admin/translations');
});

router.post('/admin/translations', requireAdmin, verifyCsrf, (req, res) => {
  const key = String(req.body.key ?? '').trim();
  if (!key) return jsonError(res, 'No key given.', 400);
  const value = String(req.body.value ?? '');
  // A translation that drops a {placeholder} or leaves a tag open would
  // break the page, so it is refused with a reason.
  const check = translations.checkValue(key, value);
  if (check.errors.length) {
    const reason = translations.fillProblem(check.errors[0]);
    if (wantsJson(req)) {
      return jsonError(res, reason, 400, { errors: check.errors, warnings: check.warnings });
    }
    req.flash('error', reason);
    return res.redirect('/admin/translations');
  }
  translations.set('ka', key, value);
  if (wantsJson(req)) return jsonOk(res, { key, value, warnings: check.warnings });
  req.flash('success', 'Translation saved.');
  return res.redirect('/admin/translations');
});

/* ── how it works ──────────────────────────────────────────────── */
/**
 * The manual page. An admin can add, retitle, reorder or delete any
 * section or line. Deleting a line also removes the Georgian
 * translation that belonged to it.
 */
router.get('/admin/how-it-works', requireAdmin, (req, res) => {
  return res.page('admin/how-it-works', {
    title: `How it works - ${config.siteName}`,
    active: 'admin',
    wide: true,
    pageScripts: [`/assets/${res.locals.assetStamp}/js/admin-how-it-works.js`],
    sections: howitworks.sections(),
    // The whole icon set, for the picker.
    iconNames: ICON_NAMES,
    // The Georgian text of a key, without the English fallback.
    kaOf: (key) => translations.dictionary('ka').get(key) || '',
  });
});

router.post('/admin/how-it-works/section', requireAdmin, verifyCsrf, (req, res) => {
  const section = howitworks.addSection({
    icon: req.body.icon,
    heading: req.body.heading,
  });
  if (!section) return fail(req, res, 'Give the section a heading.');
  if (wantsJson(req)) return jsonOk(res, { section });
  req.flash('success', 'Section added.');
  return res.redirect('/admin/how-it-works');
});

router.post('/admin/how-it-works/section/:id', requireAdmin, verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  const section = howitworks.updateSection(id, { icon: req.body.icon, heading: req.body.heading });
  if (!section) return fail(req, res, 'That section is gone.');
  if (wantsJson(req)) return jsonOk(res, { section });
  req.flash('success', 'Section saved.');
  return res.redirect('/admin/how-it-works');
});

router.post('/admin/how-it-works/section/:id/delete', requireAdmin, verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  howitworks.deleteSection(id);
  if (wantsJson(req)) return jsonOk(res, { deleted: id });
  req.flash('success', 'Section removed, together with its Georgian text.');
  return res.redirect('/admin/how-it-works');
});

router.post('/admin/how-it-works/section/:id/move', requireAdmin, verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  if (req.body.position !== undefined) howitworks.moveSectionTo(id, req.body.position);
  else howitworks.moveSection(id, req.body.direction === 'up' ? 'up' : 'down');
  if (wantsJson(req)) return jsonOk(res, { moved: id, sections: howitworks.sections() });
  return res.redirect('/admin/how-it-works');
});

router.post('/admin/how-it-works/block', requireAdmin, verifyCsrf, (req, res) => {
  const sectionId = Number(req.body.section_id);
  const block = howitworks.addBlock(sectionId, { kind: req.body.kind, body: req.body.body });
  if (!block) return fail(req, res, 'Write something first.');
  if (wantsJson(req)) return jsonOk(res, { block });
  req.flash('success', 'Line added.');
  return res.redirect('/admin/how-it-works');
});

router.post('/admin/how-it-works/block/:id', requireAdmin, verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  const block = howitworks.updateBlock(id, { kind: req.body.kind, body: req.body.body });
  if (!block) return fail(req, res, 'That line is gone.');
  if (wantsJson(res)) return jsonOk(res, { block });
  req.flash('success', 'Line saved.');
  return res.redirect('/admin/how-it-works');
});

router.post('/admin/how-it-works/block/:id/delete', requireAdmin, verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  howitworks.deleteBlock(id);
  if (wantsJson(req)) return jsonOk(res, { deleted: id });
  req.flash('success', 'Line removed, together with its Georgian text.');
  return res.redirect('/admin/how-it-works');
});

router.post('/admin/how-it-works/block/:id/move', requireAdmin, verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  if (req.body.position !== undefined) howitworks.moveBlockTo(id, req.body.position, req.body.section_id); else howitworks.moveBlock(id, req.body.direction === 'up' ? 'up' : 'down');
  if (wantsJson(res)) return jsonOk(res, { moved: id, sections: howitworks.sections() });
  return res.redirect('/admin/how-it-works');
});

router.post('/admin/partners/reorder', requireAdmin, verifyCsrf, (req, res) => {
  const order = Array.isArray(req.body.order) ? req.body.order : [];
  const pairs = order.map((item, idx) => [Number(item.id), idx]);
  partners.reorder(pairs);
  req.flash('success', 'Partner order updated.');
  if (wantsJson(req)) return jsonOk(res, { ok: true });
  return res.redirect('/admin/partners');
});

router.post('/admin/partners/:id/toggle', requireAdmin, verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  const p = partners.byId(id);
  if (!p) return fail(req, res, 'Partner not found');
  partners.update(id, { isActive: p.is_active ? 0 : 1 });
  req.flash('success', p.is_active ? 'Partner deactivated.' : 'Partner activated.');
  return res.redirect('/admin/partners');
});

/* ── service claims management ─────────────────────────────────── */
router.get('/admin/service-claims', requireAdmin, (req, res) => {
  return res.page('admin/service-claims', {
    title: `Service Claims - ${config.siteName}`,
    active: 'admin',
    wide: true,
    claims: maintenance.pendingClaims(),
  });
});

router.post('/admin/service-claims/:id/approve', requireAdmin, verifyCsrf, (req, res) => {
  const claimId = Number(req.params.id);
  const adminId = req.user.id;
  const claim = maintenance.approveClaim(claimId, adminId);
  if (!claim) {
    req.flash('error', 'Claim not found or already reviewed.');
    return res.redirect('/admin/service-claims');
  }

  // Notify the claimant
  const service = maintenance.byId(claim.service_id);
  if (service) {
    notifications.notify({
      userId: claim.claimant_id,
      actorId: adminId,
      type: 'service_claim_approved',
      entityId: claim.service_id,
      url: `/services/maintenance/${claim.service_id}`,
      text: 'your claim on {name} was approved|' + service.title,
    });
  }

  req.flash('success', 'Claim approved. Ownership transferred and service verified.');
  return res.redirect('/admin/service-claims');
});

router.post('/admin/service-claims/:id/reject', requireAdmin, verifyCsrf, (req, res) => {
  const claimId = Number(req.params.id);
  const adminId = req.user.id;
  const claim = maintenance.getClaimById(claimId);
  maintenance.rejectClaim(claimId, adminId);

  // Notify the claimant
  if (claim) {
    const service = maintenance.byId(claim.service_id);
    if (service) {
      notifications.notify({
        userId: claim.claimant_id,
        actorId: adminId,
        type: 'service_claim_rejected',
        entityId: claim.service_id,
        url: `/services/maintenance/${claim.service_id}`,
        text: 'your claim on {name} was not approved|' + service.title,
      });
    }
  }

  req.flash('success', 'Claim rejected.');
  return res.redirect('/admin/service-claims');
});

export default router;
