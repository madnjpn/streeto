import { readCookie } from './i18n.js';

/**
 * Per-member interface theme, picked in Settings.
 *
 * The choice is stored on the account (users.theme) and mirrored in a
 * cookie so guests - and the moment before the profile loads - get the
 * right palette too. `code` is what ends up in `data-theme="…"` and in
 * the CSS `[data-theme="…"]` blocks in public/css/style.css.
 */

/** Cookie that remembers a visitor's theme choice (mirrors the language one). */
export const THEME_COOKIE = 'streeto.theme';
export const THEME_COOKIE_MAX_AGE = 1000 * 60 * 60 * 24 * 365;

/** The palettes, in picker order. Labels are English source strings. */
export const THEMES = [
  {
    code: 'street',
    label: 'Street',
    desc: 'Dark asphalt with neon accents - the original look.',
  },
  {
    code: 'underground',
    label: 'Underground',
    desc: 'Red night accents from the Underground pages.',
  },
  {
    code: 'gold',
    label: 'Black & Gold',
    desc: 'Midnight black with warm gold trim.',
  },
  {
    code: 'light',
    label: 'White & Gold',
    desc: 'Bright ivory with gold trim - easy in daylight.',
  },
];

export const DEFAULT_THEME = 'street';

const CODES = new Set(THEMES.map((theme) => theme.code));

export const isTheme = (code) => CODES.has(String(code ?? '').toLowerCase());

/**
 * Theme for this request, most explicit signal first:
 * ?theme= query -> cookie -> saved profile -> street.
 */
export function resolveTheme(req) {
  const query = req.query?.theme;
  if (isTheme(query)) return String(query).toLowerCase();

  const cookie = readCookie(req, THEME_COOKIE);
  if (isTheme(cookie)) return cookie.toLowerCase();

  if (isTheme(req.user?.theme)) return req.user.theme.toLowerCase();

  return DEFAULT_THEME;
}

export default {
  THEMES,
  DEFAULT_THEME,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  isTheme,
  resolveTheme,
};
