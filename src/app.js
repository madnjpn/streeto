import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import express from 'express';
import session from 'express-session';

import config, { ROOT } from './config.js';
import { run, all } from './db.js';
import { renderView } from './lib/views.js';
import { mailUsable } from './lib/mail.js';
import { srcsetFor } from './lib/images.js';
import { webVersion, androidVersion } from './lib/app-version.js';
import { posterFor } from './lib/video-posters.js';

// Safety net for a database created before migration 020 (the migration
// itself adds the column). Wrapped, so two processes starting at the same
// moment cannot kill each other with "duplicate column name".
try {
  const cols = all(`PRAGMA table_info(builds)`);
  if (!cols.some(c => c.name === 'odometer_km')) {
    run(`ALTER TABLE builds ADD COLUMN odometer_km INTEGER`);
  }
} catch (error) {
  console.warn('[db] odometer_km check skipped:', error.message);
}

// Initialize config table for dynamic settings.
run(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`);
// The interface dictionary lives in the database so admins can correct
// the Georgian while the site is running. Seeding it here means the
// first request already has the live dictionary in memory.
import * as translations from './models/translations.js';
translations.init();
// Pick up any new wording the code has introduced, so it shows up in
// the admin's translation list instead of being forgotten.
translations.syncWithCode();
// The "How it works" page starts from the built-in copy and is then
// owned by the admin console.
import * as howitworks from './models/howitworks.js';
howitworks.seed();
import { SqliteStore } from './lib/session-store.js';
import { csrfLocals, verifyCsrf, cookieOptions, CSRF_FIELD } from './middleware/csrf.js';
import { loadUser, notFound, errorHandler, checkOrigin } from './middleware/auth.js';
import { i18n } from './lib/i18n.js';
import { THEMES, resolveTheme } from './lib/themes.js';
import {
  CURRENCIES, DEFAULT_CURRENCY, resolveCurrency, normalizeCurrency, convert, format,
} from './lib/currency.js';
import * as fmt from './lib/format.js';
import { ICONS } from './lib/icons.js';
import { SHARE_LABELS, SHARE_ICONS, shareUrl } from './lib/share.js';
import { uploadUrl } from './lib/uploads.js';
import { ptiState } from './lib/pti.js';
import * as presence from './lib/presence.js';
import { getFont, listCustomFonts, fontStacks } from './models/appearance.js';
import * as groups from './models/groups.js';

import langRoutes from './routes/lang.js';
import themeRoutes from './routes/theme.js';
import currencyRoutes from './routes/currency.js';
import authRoutes from './routes/auth.js';
import recoverRoutes from './routes/recover.js';
import wallRoutes from './routes/wall.js';
import profileRoutes from './routes/profile.js';
import friendRoutes from './routes/friends.js';
import chatRoutes from './routes/chat.js';
import buildRoutes from './routes/builds.js';
import serviceRoutes from './routes/services.js';
import garageRoutes from './routes/garage.js';
import groupRoutes from './routes/groups.js';
import meetupRoutes from './routes/meetups.js';
import notificationRoutes from './routes/notifications.js';
import searchRoutes from './routes/search.js';
import apiRoutes from './routes/api.js';
import pageRoutes from './routes/pages.js';
import adminRoutes from './routes/admin.js';
import socialRoutes from './routes/social.js';
import { startMediaQueue } from './lib/media-queue.js';

export const app = express();

app.disable('x-powered-by');
app.set('view engine', 'ejs');
app.set('views', path.join(ROOT, 'views'));
// Behind a proxy (Cloudflare, nginx) the real visitor IP and scheme arrive
// in X-Forwarded-For / X-Forwarded-Proto. Trust exactly one hop, so a
// client cannot spoof the header itself.
if (config.trustProxy) app.set('trust proxy', 1);

/* ── security headers ─────────────────────────────────────────── */
app.use((req, res, next) => {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    // cdn.jsdelivr.net serves the jsQR decoder for the map picker, and
    // static.cloudflareinsights.com serves Cloudflare's Web Analytics
    // beacon - without it the browser blocks the script and logs a CSP
    // error on every page.
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://static.cloudflareinsights.com",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://tiles.openfreemap.org https://www.rockauto.com https://images.weserv.nl",
    "media-src 'self' blob:",
    "connect-src 'self' blob: data: https://cdn.jsdelivr.net https://cloudflareinsights.com https://tiles.openfreemap.org",
  ].join('; ');

  res.set({
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(self), camera=(self), microphone=()',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  next();
});

/* ── body parsing + sessions ──────────────────────────────────── */
// Uploads go through multer route-by-route, so the global parsers only
// ever see urlencoded/JSON payloads.
app.use(express.urlencoded({ extended: false, limit: '256kb' }));
app.use(express.json({ limit: '256kb' }));

app.use(
  session({
    name: 'streeto.sid',
    secret: config.sessionSecret,
    store: new SqliteStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: cookieOptions,
  }),
);

app.use(loadUser);
app.use(csrfLocals);
app.use(i18n);
app.use((req, res, next) => {
  // Provide myGroups for the sidebar on every page.
  if (req.user) {
    try {
      res.locals.myGroups = groups.myGroups(req.user.id).filter((g) => g.status === 'active').slice(0, 5);
    } catch (e) {
      console.error('[ERROR] myGroups failed:', e.message);
      res.locals.myGroups = [];
    }
  } else {
    res.locals.myGroups = [];
  }
  // Who has a socket open right now - the friends list marks them with a dot.
  res.locals.isOnline = presence.isOnline;
  next();
});

// Every authenticated request means the member is around - that is what the
// online dot next to a friend is built on.
app.use((req, res, next) => {
  if (req.user) presence.touch(req.user.id);
  next();
});
app.use((req, res, next) => {
  // Theme is resolved per-request, like the language, so it is live as
  // soon as the picker posts its choice.
  res.locals.theme = resolveTheme(req);
  res.locals.themes = THEMES;
  next();
});
app.use((req, res, next) => {
  // Every price is stored in the seller's currency and read in the
  // visitor's; `money` converts, `moneyAlt` shows the seller's original
  // figure (small) when the two currencies differ.
  const currency = resolveCurrency(req);
  res.locals.currency = currency;
  res.locals.currencies = CURRENCIES;
  res.locals.money = (amount, from) => {
    if (amount === null || amount === undefined || amount === '') return '';
    return format(convert(amount, from, currency), currency);
  };
  res.locals.moneyAlt = (amount, from) => {
    if (amount === null || amount === undefined || amount === '') return '';
    const src = normalizeCurrency(from) ?? DEFAULT_CURRENCY;
    return src === currency ? '' : format(amount, src);
  };
  next();
});
app.use(checkOrigin);

/* ── static assets ────────────────────────────────────────────── */
// The app's own CSS and JS are served under a versioned path
// (/assets/<stamp>/js/app.js). The stamp changes the moment any file in
// public/js or public/css changes, so the browser can cache them for a
// long time and still pick up an edit on the next reload - no manual
// ?v= bumping, and no week-old script quietly running in someone's tab.
//
// The plain /js and /css paths stay as a fallback (and for anything that
// hard-codes them); they revalidate on every request.
const ASSET_DIRS = [path.join(ROOT, 'public', 'js'), path.join(ROOT, 'public', 'css')];

/** A short fingerprint of every app asset, used to bust the browser cache. */
function computeAssetStamp() {
  const parts = [];
  for (const dir of ASSET_DIRS) {
    let names = [];
    try {
      names = fs.readdirSync(dir).filter((n) => /\.(js|css)$/.test(n)).sort();
    } catch {
      names = [];
    }
    for (const name of names) {
      try {
        const st = fs.statSync(path.join(dir, name));
        parts.push(`${name}:${st.size}:${Math.floor(st.mtimeMs)}`);
      } catch {
        /* the file vanished between the read and the stat - ignore it */
      }
    }
  }
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 10);
}

let assetStampCache = { value: computeAssetStamp(), at: Date.now() };
/** The current asset stamp, refreshed at most once every 30 seconds. */
function assetStamp() {
  if (Date.now() - assetStampCache.at > 30_000) {
    assetStampCache = { value: computeAssetStamp(), at: Date.now() };
  }
  return assetStampCache.value;
}

app.use(
  '/assets/:stamp/js',
  express.static(path.join(ROOT, 'public', 'js'), {
    maxAge: config.isProd ? '30d' : 0,
    immutable: config.isProd,
  }),
);
app.use(
  '/assets/:stamp/css',
  express.static(path.join(ROOT, 'public', 'css'), {
    maxAge: config.isProd ? '30d' : 0,
    immutable: config.isProd,
  }),
);
app.use(
  '/css',
  express.static(path.join(ROOT, 'public', 'css'), { maxAge: 0, etag: true, lastModified: true }),
);
app.use(
  '/js',
  express.static(path.join(ROOT, 'public', 'js'), { maxAge: 0, etag: true, lastModified: true }),
);
app.use(
  '/icons',
  express.static(path.join(ROOT, 'public', 'icons'), {
    maxAge: config.isProd ? '30d' : 0,
    immutable: config.isProd,
    etag: true,
  }),
);
app.get('/manifest.webmanifest', (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'manifest.webmanifest'), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' },
    maxAge: config.isProd ? '1h' : 0,
  });
});
app.get('/offline.html', (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'offline.html'), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    maxAge: 0,
  });
});

// The Android test build. Kept out of the asset stamp on purpose: the
// file is replaced by a new build without a code change, so it must not
// be cached forever.
app.use(
  '/downloads',
  express.static(path.join(ROOT, 'public', 'downloads'), {
    maxAge: 0,
    etag: true,
    lastModified: true,
    setHeaders(res, filePath) {
      if (String(filePath).toLowerCase().endsWith('.apk')) {
        res.setHeader('Content-Type', 'application/vnd.android.package-archive');
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
      }
    },
  }),
);

// The service worker has to be served from the root so it can control the
// whole origin - push notifications and the offline shell depend on it.
app.get('/sw.js', (req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'sw.js'), {
    headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
    maxAge: config.isProd ? '1d' : 0,
  });
});


// The site logo lives at the project root (`websitelogo.png`) so it can be
// swapped by simply replacing that file — no deploy or code change needed.
// Cache is disabled (maxAge 0) so a replaced file is picked up immediately.
app.get('/websitelogo.png', (req, res) => {
  const file = path.join(ROOT, 'websitelogo.png');
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file, { maxAge: 0, lastModified: true, etag: true });
});

// Favicon lives at the project root (`favicon.ico`) for easy replacement.
app.get('/favicon.ico', (req, res) => {
  const file = path.join(ROOT, 'favicon.ico');
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file, { maxAge: 0, lastModified: true, etag: true });
});

// Georgian flag shown on the number-plate badge. Also kept at the project
// root so it can be swapped by replacing `flag.png`.
app.get('/flag.png', (req, res) => {
  const file = path.join(ROOT, 'flag.png');
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file, { maxAge: 0, lastModified: true, etag: true });
});

// Uploaded photos/videos. Range requests are handled by express.static,
// which is what makes <video> seeking work.
app.use(
  '/uploads',
  express.static(config.uploadDir, {
    dotfiles: 'deny',
    index: false,
    maxAge: '7d',
    fallthrough: true,
    setHeaders(res) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  }),
);

// MapLibre GL straight from node_modules so the maps work without a CDN.
if (fs.existsSync(path.join(config.maplibreDir, 'maplibre-gl.js'))) {
  app.use(
    '/vendor/maplibre',
    express.static(config.maplibreDir, { maxAge: config.isProd ? '30d' : 0 }),
  );
}

/* ── view helpers ─────────────────────────────────────────────── */
app.locals.f = fmt;
app.locals.config = config;
app.locals.csrfField = CSRF_FIELD;
// The inline icon set, shared with the admin console's icon picker.
app.locals.ICONS = ICONS;
app.locals.maplibreAvailable = fs.existsSync(path.join(config.maplibreDir, 'maplibre-gl.js'));

/**
 * `res.page('wall/index', data)` renders the view and then wraps it in
 * layout.ejs, so page templates never repeat the shell.
 *
 * Everything a template might need is copied onto res.locals first,
 * because ejs.renderFile does not know about Express locals.
 */
app.use((req, res, next) => {
  // `res.locals.f` comes from the i18n middleware (language-aware helpers).
  res.locals.config = config;
  res.locals.csrfField = CSRF_FIELD;
  // The inline icon set, shared with the admin console's icon picker.
  // It has to be an own property of res.locals - the inherited ones are
  // lost when the locals are spread into a view.
  res.locals.ICONS = ICONS;
  // The words for a shared thing in a chat.
  // A forgot-password link that cannot send a letter is worse than no
  // link at all, so the login screen only shows one when mail works.
  res.locals.mailReady = mailUsable();
  res.locals.shareLabel = (type) => SHARE_LABELS[type] || 'Link';
  res.locals.shareIcon = (type) => SHARE_ICONS[type] || 'share';
  res.locals.shareUrl = shareUrl;
  res.locals.ptiState = ptiState;
  res.locals.maplibreAvailable = app.locals.maplibreAvailable;
  // The cache-busting stamp for /assets/<stamp>/... URLs.
  res.locals.assetStamp = assetStamp();
  res.locals.asset = (file) => `/assets/${assetStamp()}/${file}`;
  // The smaller copies of a picture, so the browser can take the one
  // that fits the screen it is on.
  res.locals.srcset = (stored) => srcsetFor(stored);
  res.locals.poster = posterFor;
  res.locals.query = req.query || {};
  res.locals.path = req.path;
  res.locals.title = config.siteName;
  // Versions shown in the footer and on the settings page. Reading the
  // Android version per request means a freshly copied APK is picked up
  // without restarting the server.
  res.locals.webVersion = webVersion;
  res.locals.androidRelease = androidVersion();
  res.locals.maxUploadMb = config.maxUploadMb;
  res.locals.currentFont = getFont();
  res.locals.fontStacks = fontStacks;
  const stacks = fontStacks(res.locals.currentFont);
  res.locals.fontHeadStack = stacks.head;
  res.locals.fontBodyStack = stacks.body;
  res.locals.fontMonoStack = stacks.mono;
  res.locals.customFonts = listCustomFonts().map((f) => ({
    id: f.id,
    family: f.family,
    filename: f.filename,
    format: f.format,
    weight: f.weight,
    style: f.style,
    lang: f.lang,
    usage: f.usage,
    url: uploadUrl(f.filename),
  }));

  res.page = async (view, data = {}) => {
    const locals = { ...res.locals, ...data };
    const body = await renderView(view, locals);
    const html = await renderView('layout', { ...locals, body });
    return res.send(html);
  };
  next();
});

/* ── routes ───────────────────────────────────────────────────── */
app.use('/', langRoutes);
app.use('/', themeRoutes);
app.use('/', currencyRoutes);
app.use('/', authRoutes);
app.use('/', recoverRoutes);
app.use('/', wallRoutes);
app.use('/', profileRoutes);
app.use('/', friendRoutes);
app.use('/', chatRoutes);
app.use('/', buildRoutes);
app.use('/', serviceRoutes);
app.use('/', garageRoutes);
app.use('/', groupRoutes);
app.use('/', meetupRoutes);
app.use('/', notificationRoutes);
app.use('/', searchRoutes);
app.use('/', adminRoutes);
app.use('/', socialRoutes);
app.use('/', pageRoutes);
app.use('/api', apiRoutes);

app.use(notFound);
app.use(errorHandler);

/* One process owns the media queue. It recovers interrupted jobs on boot and
   drains work in the background; uploads never wait for FFmpeg. */
if (process.env.MEDIA_QUEUE_DISABLED !== '1') startMediaQueue();

export default app;
