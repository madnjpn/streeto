import crypto from 'node:crypto';
import config from '../config.js';

/**
 * Session-bound CSRF protection.
 *
 * A random token lives in the session and is echoed into every form as
 * a hidden `_csrf` field (or an `x-csrf-token` header for fetch calls).
 * Verification must run *after* the body has been parsed - for
 * multipart routes that means after multer, so routes are declared as
 *   app.post('/x', upload, verifyCsrf, handler)
 */
export const CSRF_FIELD = '_csrf';
const HEADER = 'x-csrf-token';

export function ensureToken(req) {
  if (!req.session) return '';
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('base64url');
  return req.session.csrfToken;
}

/** Make the token available to templates as `csrfToken`. */
export function csrfLocals(req, res, next) {
  const token = ensureToken(req);
  res.locals.csrfToken = token;
  res.locals.csrfField = CSRF_FIELD;
  next();
}

const safeEqual = (a, b) => {
  const bufA = Buffer.from(String(a ?? ''));
  const bufB = Buffer.from(String(b ?? ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
};

export function verifyCsrf(req, res, next) {
  const expected = req.session?.csrfToken;
  const supplied = (req.body && req.body[CSRF_FIELD]) || req.get(HEADER) || '';
  if (!expected || !safeEqual(supplied, expected)) {
    const t = req.t || ((key) => key);
    const error = new Error(t('Invalid or expired security token. Reload the page and try again.'));
    error.status = 403;
    error.code = 'CSRF';
    return next(error);
  }
  return next();
}

/** Small helper used inside templates: hidden input with the token. */
export const csrfInput = (token) =>
  `<input type="hidden" name="${CSRF_FIELD}" value="${token}">`;

export const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProd,
  maxAge: config.sessionMaxAgeMs,
  path: '/',
};

export default { csrfLocals, verifyCsrf, ensureToken, CSRF_FIELD, csrfInput, cookieOptions };
