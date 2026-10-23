import express from 'express';
import config from '../config.js';
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, isTheme } from '../lib/themes.js';
import * as users from '../models/users.js';

const router = express.Router();

/** Bounce back to the page the picker was clicked on, same-site only. */
function backTo(req) {
  const referer = req.get('referer');
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.host === req.get('host')) {
        url.searchParams.delete('theme');
        const target = `${url.pathname}${url.search}`;
        if (target.startsWith('/') && !target.startsWith('//')) return target;
      }
    } catch {
      /* malformed referer - fall back to the settings page */
    }
  }
  return '/settings';
}

/**
 * Theme picker endpoint. Plain links (no JavaScript required), exactly
 * like the language switcher:
 *   <a href="/theme/gold">…</a>
 * Stores the choice on the account when logged in, and in a cookie
 * always, so the palette survives even before the profile loads.
 */
router.get('/theme/:code', (req, res) => {
  const code = String(req.params.code ?? '').toLowerCase();
  const target = backTo(req);

  if (!isTheme(code)) return res.redirect(target);

  res.cookie(THEME_COOKIE, code, {
    maxAge: THEME_COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    path: '/',
  });

  if (req.isAuthenticated()) users.setTheme(req.user.id, code);

  return res.redirect(target);
});

export default router;
