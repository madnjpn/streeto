import express from 'express';
import config from '../config.js';
import { CURRENCY_COOKIE, CURRENCY_COOKIE_MAX_AGE, normalizeCurrency } from '../lib/currency.js';
import * as users from '../models/users.js';

const router = express.Router();

/** Bounce back to the page the switcher was clicked on, same-site only. */
function backTo(req) {
  const referer = req.get('referer');
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.host === req.get('host')) {
        url.searchParams.delete('currency');
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
 * Currency picker endpoint. Plain links (no JavaScript required), exactly
 * like the language and theme switchers:
 *   <a href="/currency/USD">…</a>
 * Stores the choice on the account when logged in, and in a cookie
 * always, so prices read the right way even before the profile loads.
 */
router.get('/currency/:code', (req, res) => {
  const code = normalizeCurrency(req.params.code);
  const target = backTo(req);

  if (!code) return res.redirect(target);

  res.cookie(CURRENCY_COOKIE, code, {
    maxAge: CURRENCY_COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    path: '/',
  });

  if (req.isAuthenticated()) users.setCurrency(req.user.id, code);

  return res.redirect(target);
});

export default router;
