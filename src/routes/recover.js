/**
 * Password recovery.
 *
 * The driver types a username or an email on the login screen. A username
 * gets one extra step - the site shows which address it would be sent to,
 * so nobody sends a link to the wrong inbox - and then a one-time letter
 * goes out. The link opens a page that sets a new password.
 *
 * Two rules the whole file follows:
 *   - an email address is never confirmed: a stranger must not be able to
 *     find out whether somebody is registered here by typing addresses;
 *   - a link works once, for an hour, and dies when the password changes.
 */
import express from 'express';
import config from '../config.js';
import { readCookie } from '../lib/i18n.js';
import { hashPassword } from '../lib/password.js';
import { checkPassword } from '../lib/validate.js';
import { mailUsable, sendMail } from '../lib/mail.js';
import { resetEmail } from '../lib/mail-templates.js';
import { requireGuest } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { rateLimit } from '../middleware/rate-limit.js';
import * as users from '../models/users.js';
import * as resets from '../models/password-resets.js';

const router = express.Router();

/** The same cookie the login form prefills from. */
const LAST_LOGIN_COOKIE = 'streeto.login';

const askLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 6,
  message: 'Too many password requests. Wait an hour and try again.',
});

const confirmLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many password requests. Wait an hour and try again.',
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  message: 'Too many tries. Wait a few minutes and try again.',
});

/** https://streeto.net, or the host this request came in on. */
const baseUrl = (req) => config.publicUrl || `${req.protocol}://${req.get('host')}`;

/**
 * ma***@gmail.com - enough to recognise your own inbox, not enough to
 * hand somebody's address to anyone who knows their username.
 */
function maskEmail(email) {
  const [local = '', domain = ''] = String(email || '').split('@');
  if (!local || !domain) return '';
  const keep = local.length <= 2 ? 1 : 2;
  return `${local.slice(0, keep)}${'*'.repeat(Math.min(6, Math.max(3, local.length - keep)))}@${domain}`;
}

/** Everything the two pages need, so no view ever guesses a local. */
const page = (req, data) => ({
  title: `${req.t('Recover the account')} - ${config.siteName}`,
  minutes: config.mail.resetMinutes,
  step: 'ask',
  login: '',
  masked: '',
  token: '',
  username: '',
  bad: false,
  error: null,
  notice: null,
  ...data,
});

/**
 * Make a link and post it.
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function sendReset(req, user) {
  const minutes = config.mail.resetMinutes;

  if (!mailUsable()) return { ok: false, reason: 'nomail' };

  // Three letters per quarter of an hour is plenty, even for somebody who
  // keeps losing the link.
  if (resets.recentForUser(user.id, 15 * 60 * 1000) >= 3) {
    return { ok: false, reason: 'recent' };
  }

  resets.purge();

  const token = resets.makeToken();
  resets.create({
    userId: user.id,
    token,
    email: user.email,
    ip: req.ip,
    ttlMs: minutes * 60 * 1000,
  });

  const siteUrl = baseUrl(req);
  const letter = resetEmail({
    t: req.t,
    user,
    link: `${siteUrl}/reset/${token}`,
    minutes,
    siteName: config.siteName,
    siteUrl,
    logoUrl: `${siteUrl}/websitelogo.png`,
  });

  try {
    await sendMail({
      to: user.email,
      subject: letter.subject,
      html: letter.html,
      text: letter.text,
    });
    return { ok: true };
  } catch (error) {
    console.error('[mail] the password letter did not go out:', error.message);
    resets.forgetAll(user.id);
    return { ok: false, reason: 'send' };
  }
}

/**
 * One form field, even if the browser sent it twice: a duplicated input
 * used to turn `madnjpn` into `madnjpn,madnjpn` and nothing was found.
 */
const field = (value) => String(Array.isArray(value) ? value[0] : (value ?? '')).trim();

/** Turn a failed send into something the driver can read. */function problem(req, reason) {
  if (reason === 'recent') {
    return {
      notice: req.t(
        'A link was sent a moment ago. Check the inbox - it is good for {minutes} minutes.',
        { minutes: config.mail.resetMinutes },
      ),
    };
  }
  if (reason === 'send') {
    return { error: req.t('The letter could not be sent. Try again in a minute.') };
  }
  return {
    error: req.t('Mail is not set up yet - the site cannot send the letter. Tell the admin.'),
  };
}

/* ------------------------------------------------------------------ */
/* Step 1: who are you                                                 */
/* ------------------------------------------------------------------ */

router.get('/forgot', requireGuest, (req, res) => {
  if (!mailUsable()) {
    req.flash('error', 'Mail is not set up yet - the site cannot send the letter. Tell the admin.');
    return res.redirect('/login');
  }
  return res.page(
    'auth/forgot',
    page(req, {
      login: readCookie(req, LAST_LOGIN_COOKIE) || '',
    }),
  );
});

router.post('/forgot', requireGuest, askLimiter, verifyCsrf, async (req, res) => {
  const login = field(req.body?.login);
  const typedEmail = login.includes('@');

  if (!login) {
    return res
      .status(400)
      .page('auth/forgot', page(req, { login, error: req.t('Type your username or email.') }));
  }

  const user = users.findByLogin(login);

  /* An address that is not registered gets the same answer as one that
     is: the site does not tell strangers who lives here. */
  if (!user) {
    if (typedEmail) {
      return res.page('auth/forgot', page(req, { login, step: 'sent', masked: maskEmail(login) }));
    }
    return res.status(404).page(
      'auth/forgot',
      page(req, { login, error: req.t('That username is not registered.') }),
    );
  }

  /* A username: show the inbox first, and let the driver say yes. */
  if (!typedEmail) {
    return res.page('auth/forgot', page(req, { login, step: 'confirm', masked: maskEmail(user.email) }));
  }

  const result = await sendReset(req, user);
  if (!result.ok) {
    return res
      .status(429)
      .page('auth/forgot', page(req, { login, step: 'ask', masked: maskEmail(user.email), ...problem(req, result.reason) }));
  }
  return res.page('auth/forgot', page(req, { login, step: 'sent', masked: maskEmail(user.email) }));
});

/* Step 1b: yes, that inbox is mine. */
router.post('/forgot/confirm', requireGuest, confirmLimiter, verifyCsrf, async (req, res) => {
  const login = field(req.body?.login);
  const user = users.findByLogin(login);

  if (!user) {
    return res
      .status(404)
      .page('auth/forgot', page(req, { login, error: req.t('That username is not registered.') }));
  }

  const result = await sendReset(req, user);
  if (!result.ok) {
    return res
      .status(429)
      .page('auth/forgot', page(req, { login, step: 'ask', ...problem(req, result.reason) }));
  }
  return res.page('auth/forgot', page(req, { login, step: 'sent', masked: maskEmail(user.email) }));
});

/* ------------------------------------------------------------------ */
/* Step 2: the letter                                                  */
/* ------------------------------------------------------------------ */

/* No requireGuest here: a driver who asked for the link on the phone
   usually clicks it on the laptop where he is still signed in. The
   token is the credential, not the cookie. */

router.get('/reset/:token', (req, res) => {
  const row = resets.findOpen(req.params.token);
  if (!row) {
    return res.status(410).page('auth/reset', page(req, { bad: true }));
  }
  return res.page('auth/reset', page(req, { token: req.params.token, username: row.username }));
});

router.post('/reset/:token', resetLimiter, verifyCsrf, async (req, res) => {
  const token = req.params.token;
  const row = resets.findOpen(token);

  if (!row) {
    return res.status(410).page('auth/reset', page(req, { bad: true }));
  }

  const password = String(req.body?.password ?? '');
  const repeat = String(req.body?.confirm ?? '');
  const shape = { token, username: row.username };

  const check = checkPassword(password, { username: row.username });
  if (!check.ok) {
    return res
      .status(400)
      .page('auth/reset', page(req, { ...shape, error: req.t(check.error) }));
  }

  if (password !== repeat) {
    return res
      .status(400)
      .page('auth/reset', page(req, { ...shape, error: req.t('Passwords do not match.') }));
  }

  await users.updatePassword(row.user_id, await hashPassword(password));

  /* The link is spent, every other link dies with it, and every session
     of the account is logged out: a new password must not leave an old
     phone (or a stolen cookie) sitting inside. */
  resets.consume(row.id);
  resets.forgetAll(row.user_id);
  resets.clearSessions(row.user_id);

  /* This browser may be one of those sessions - a driver who reset the
     password while signed in must not stay signed in on the old cookie. */
  if (req.session?.userId) delete req.session.userId;

  req.flash('success', 'Your password is changed. Log in with the new one.');
  return res.redirect('/login');
});

export default router;
