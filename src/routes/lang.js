import express from 'express';
import config from '../config.js';
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE, isLang } from '../lib/i18n.js';
import * as users from '../models/users.js';

const router = express.Router();

/** Bounce back to the page the switcher was clicked on, same-site only. */
function backTo(req) {
  const referer = req.get('referer');
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.host === req.get('host')) {
        url.searchParams.delete('lang');
        const target = `${url.pathname}${url.search}`;
        if (target.startsWith('/') && !target.startsWith('//')) return target;
      }
    } catch {
      /* malformed referer - fall back to the wall */
    }
  }
  return '/';
}

/**
 * Language switcher endpoint. Plain links (no JavaScript required):
 *   <a href="/lang/ka">…</a>
 * Stores the choice on the account when logged in, and in a cookie
 * always, so guests keep their language across visits too.
 */
router.get('/lang/:code', (req, res) => {
  const code = String(req.params.code ?? '').toLowerCase();
  const target = backTo(req);

  if (!isLang(code)) return res.redirect(target);

  res.cookie(LANG_COOKIE, code, {
    maxAge: LANG_COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    path: '/',
  });

  if (req.isAuthenticated()) users.setLanguage(req.user.id, code);

  return res.redirect(target);
});

export default router;
