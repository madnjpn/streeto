import { get, all, run } from '../db.js';
import { PUBLIC_FIELDS } from '../models/users.js';
import { wantsJson } from '../lib/http.js';

/**
 * Load the logged-in user (if any) and expose the usual `req.user`,
 * `req.isAuthenticated()` plus small flash-message helpers.
 */
export function loadUser(req, res, next) {
  req.user = null;

  const id = req.session?.userId;
  if (id) {
    // PUBLIC_FIELDS is the shared column list, so anything we add to a
    // user (like the service-provider flag) is live on the next request
    // without a second query or a stale session snapshot.
    const user = get(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = ?`, id);
    if (user) {
      req.user = user;
    } else {
      // Account was deleted while the session was alive.
      delete req.session.userId;
    }
  }

  req.isAuthenticated = () => Boolean(req.user);

  /* ── flash messages ─────────────────────────────────────────── */
  const flashes = req.session?.flashes || [];
  req.session && (req.session.flashes = []);

  /**
   * A flash keeps the English key and the values that fill it, so it is
   * translated when it is shown - in the language of whoever reads it.
   * Storing the finished text would turn every message with a name in
   * it into a string of its own.
   */
  req.flash = (type, message, vars = null) => {
    if (!req.session) return;
    req.session.flashes = req.session.flashes || [];
    req.session.flashes.push({ type, message, vars });
    return req.flash;
  };

  res.locals.currentUser = req.user;
  res.locals.flashes = flashes;
  res.locals.isAuthenticated = Boolean(req.user);
  res.locals.isAdmin = Boolean(req.user?.is_admin);
  res.locals.unreadMessages = req.user ? unreadCount(req.user.id) : 0;
  res.locals.pendingRequests = req.user ? pendingRequestCount(req.user.id) : 0;
  res.locals.unreadNotifications = req.user ? unreadNotificationCount(req.user.id) : 0;

  next();
}

function unreadCount(userId) {
  return (
    get(
      `SELECT COUNT(*) AS n
         FROM messages m
         JOIN conversation_members cm
           ON cm.conversation_id = m.conversation_id AND cm.user_id = ?
        WHERE m.sender_id <> ?
          AND m.id > cm.last_read_id
          AND (cm.cleared_at IS NULL OR m.created_at > cm.cleared_at)`,
      userId,
      userId,
    )?.n ?? 0
  );
}

function pendingRequestCount(userId) {
  return (
    get(
      `SELECT COUNT(*) AS n FROM friendships WHERE addressee_id = ? AND status = 'pending'`,
      userId,
    )?.n ?? 0
  );
}

function unreadNotificationCount(userId) {
  return (
    get('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', userId)?.n ?? 0
  );
}

/** Page requires a login. */
export function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  if (req.method === 'GET') req.session.returnTo = req.originalUrl;
  req.flash('error', 'Log in first - that area is for members only.');
  return res.redirect('/login');
}

/** Page is only for logged-out visitors (login/register). */
export function requireGuest(req, res, next) {
  if (!req.isAuthenticated()) return next();
  return res.redirect('/');
}

/** Anything under /admin. Must be logged in *and* carry the admin flag. */
export function requireAdmin(req, res, next) {
  if (!req.isAuthenticated()) {
    if (req.method === 'GET') req.session.returnTo = req.originalUrl;
    req.flash('error', 'Log in first - that area is for members only.');
    return res.redirect('/login');
  }
  if (!req.user.is_admin) {
    const error = new Error((req.t || ((key) => key))('Admins only.'));
    error.status = 403;
    return next(error);
  }
  return next();
}

/** Block cross-site form posts from other origins. */
export function checkOrigin(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next(); // same-origin form posts often omit Origin
  try {
    const host = req.get('host');
    if (new URL(origin).host === host) return next();
  } catch {
    /* fall through to the rejection below */
  }
  const error = new Error('Cross-origin request blocked.');
  error.status = 403;
  return next(error);
}

/** 404 handler. */
export function notFound(req, res, next) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ ok: false, error: (req.t || ((key) => key))('Not found') });
  }
  res.status(404);
  const t = req.t || ((key) => key);
  return res.page('error', {
    title: t('404 - off grid'),
    status: 404,
    heading: t('404 - wrong turn'),
    message: t('That page is not on the map. Check the link or head back to the wall.'),
  });
}

/** Central error handler. */
export function errorHandler(error, req, res, _next) {
  const status = error.status && error.status >= 400 && error.status < 600 ? error.status : 500;

  if (status >= 500) console.error('[error]', error);

  const t = req.t || ((key) => key);

  const message =
    error.code === 'LIMIT_FILE_SIZE'
      ? t('That file is too big. Try something smaller.')
      : error.code === 'UNSUPPORTED_MEDIA_TYPE'
        ? error.message
        : error.code === 'LIMIT_UNEXPECTED_FILE'
          ? t('Unexpected upload field.')
          : status >= 500
            ? t('Something went wrong on our side. Try again.')
            : error.message;

  if (req.path.startsWith('/api/') || wantsJson(req)) {
    return res.status(status).json({ ok: false, error: message });
  }

  res.status(status);
  return res.page('error', {
    title: t('{status} - stalled', { status }),
    status,
    heading: status === 403
      ? t('403 - blocked')
      : status === 429
        ? t('429 - too fast')
        : t('{status} - engine trouble', { status }),
    message,
  });
}

export const helpers = { unreadCount, pendingRequestCount, unreadNotificationCount };

export default { loadUser, requireAuth, requireGuest, requireAdmin, notFound, errorHandler, checkOrigin };
