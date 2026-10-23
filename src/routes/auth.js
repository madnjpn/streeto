import express from 'express';
import config from '../config.js';
import { validateRegistration, checkUsername } from '../lib/validate.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { readCookie } from '../lib/i18n.js';
import * as users from '../models/users.js';
import * as chat from '../models/chat.js';
import { requireGuest } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { ensureUserFolder } from '../lib/upload-paths.js';

const router = express.Router();

/** Remembers the last username typed so the login form is prefilled. */
const LAST_LOGIN_COOKIE = 'streeto.login';
const LAST_LOGIN_MAX_AGE = 1000 * 60 * 60 * 24 * 365;

const rememberLogin = (res, username) =>
  res.cookie(LAST_LOGIN_COOKIE, username, {
    maxAge: LAST_LOGIN_MAX_AGE,
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    path: '/',
  });

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 12,
  message: 'Too many login attempts. Wait a few minutes and try again.',
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many accounts created from this address. Try again later.',
});

/** Remember where the user was headed before being bounced to login. */
function safeReturnTo(value, fallback = '/') {
  const target = String(value ?? '');
  if (!target.startsWith('/') || target.startsWith('//')) return fallback;
  return target;
}

/* ── register ─────────────────────────────────────────────────── */
router.get('/register', requireGuest, (req, res) =>
  res.page('auth/register', {
    title: `${req.t('Join up')} - ${req.app.locals.config.siteName}`,
    values: { username: '', email: '', display_name: '' },
    errors: {},
  }),
);

router.post('/register', requireGuest, registerLimiter, verifyCsrf, async (req, res) => {
  const result = validateRegistration(req.body);

  if (!result.ok) {
    return res.status(400).page('auth/register', {
      title: `${req.t('Join up')} - ${req.app.locals.config.siteName}`,
      values: { ...result.values, username: req.body.username, email: req.body.email, display_name: req.body.display_name },
      errors: result.errors,
    });
  }

  const errors = {};
  if (users.usernameTaken(result.values.username)) errors.username = req.t('That username is already taken.');
  if (users.emailTaken(result.values.email)) errors.email = req.t('That email is already registered.');

  if (Object.keys(errors).length) {
    return res.status(409).page('auth/register', {
      title: `${req.t('Join up')} - ${req.app.locals.config.siteName}`,
      values: { ...result.values, username: req.body.username, email: req.body.email, display_name: req.body.display_name },
      errors,
    });
  }

  const passwordHash = await hashPassword(req.body.password);
  const user = users.createUser({ ...result.values, passwordHash, language: req.lang });
  chat.joinGlobal(user.id);
  // Every driver keeps their own folder for the pictures they upload.
  ensureUserFolder(user.id);

  // Log the new member straight in. regenerate() prevents session fixation.
  req.session.regenerate((error) => {
    if (error) return res.redirect('/login');
    req.session.userId = user.id;
    if (req.body.remember !== '1') req.session.cookie.maxAge = null;
    rememberLogin(res, user.username);
    req.flash('success', 'Welcome to the underground, @{user}. Build your profile and find your group.', { user: user.username });
    return res.redirect('/');
  });
});

/* ── login ────────────────────────────────────────────────────── */
router.get('/login', requireGuest, (req, res) =>
  res.page('auth/login', {
    title: `${req.t('Log in')} - ${req.app.locals.config.siteName}`,
    values: { login: readCookie(req, LAST_LOGIN_COOKIE) || '' },
    error: null,
  }),
);

router.post('/login', requireGuest, loginLimiter, verifyCsrf, async (req, res) => {
  const login = String(req.body.login ?? '').trim();
  const password = String(req.body.password ?? '');
  const remember = req.body.remember === '1';

  const render = (error, status = 401) =>
    res.status(status).page('auth/login', {
      title: `${req.t('Log in')} - ${req.app.locals.config.siteName}`,
      values: { login },
      error,
    });

  if (!login || !password) return render(req.t('Enter your username (or email) and password.'), 400);

  const record = users.findWithHash(login);
  let ok = false;
  if (record) {
    ok = await verifyPassword(password, record.password_hash);
  } else {
    // Burn a comparable amount of time so missing accounts and wrong
    // passwords are not distinguishable by response time.
    await hashPassword(password);
  }

  if (!ok) return render(req.t('Wrong username or password. Try again.'));

  const { password_hash: _ignored, ...user } = record;
  req.session.regenerate((error) => {
    if (error) return render(req.t('Could not start a session. Try again.'), 500);
    req.session.userId = user.id;
    // "Keep me logged in" unchecked -> the cookie dies with the browser.
    if (!remember) req.session.cookie.maxAge = null;
    rememberLogin(res, user.username);
    const to = safeReturnTo(req.session.returnTo, '/');
    delete req.session.returnTo;
    req.flash('success', 'Back on the road, @{user}.', { user: user.username });
    return res.redirect(to);
  });
});

/* ── logout ───────────────────────────────────────────────────── */
router.post('/logout', verifyCsrf, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('streeto.sid', { path: '/' });
    res.redirect('/login');
  });
});

/* ── username availability (used by the register form) ────────── */
router.get('/api/username-check', (req, res) => {
  const check = checkUsername(req.query.u);
  if (!check.ok) return res.json({ ok: false, available: false, message: check.error });
  const available = !users.usernameTaken(check.value);
  return res.json({
    ok: true,
    available,
    message: available ? 'That name is free.' : 'That username is already taken.',
  });
});

export default router;
