import ka from './locales/ka.js';
import * as fmt from './format.js';
import { buildClientStrings } from './client-strings.js';
import * as translations from '../models/translations.js';

/**
 * Tiny translation layer for the server-rendered views.
 *
 * Keys are the English source strings themselves, which means:
 *   - an untranslated key renders its English text (graceful fallback);
 *   - the English UI is byte-identical to before i18n was added;
 *   - templates stay readable:  <%= t('Wall') %>
 *
 * `{name}` placeholders are replaced from the `vars` object.
 */

/** Cookie that remembers a visitor's language choice. */
export const LANG_COOKIE = 'streeto.lang';
export const LANG_COOKIE_MAX_AGE = 1000 * 60 * 60 * 24 * 365;

/** Languages the interface ships with, in switcher order. */
export const LANGS = [
  { code: 'en', short: 'EN', label: 'English', native: 'English' },
  { code: 'ka', short: 'GE', label: 'Georgian', native: 'ქართული' },
];

export const DEFAULT_LANG = 'en';

const DICTS = { ka };
const CODES = new Set(LANGS.map((lang) => lang.code));

export const isLang = (code) => CODES.has(String(code ?? '').toLowerCase());

/** Translate `key` into `lang`, interpolating `{placeholders}`. */
export function translate(lang, key, vars) {
  if (key === undefined || key === null) return '';
  const source = String(key);
  // The live dictionary holds the finished text: an admin's correction,
  // or the English key itself when there is no translation yet.
  const live = translations.dictionary(lang);
  let text = live.get(source);
  if (text === undefined) {
    // A string the code has never shown before. Register it so it turns
    // up in the admin's translation list instead of being forgotten.
    translations.registerMissing(lang, source);
    text = (DICTS[lang] && DICTS[lang][source]) || source;
  }
  if (vars) {
    text = text.replace(/\{(\w+)\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
    );
  }
  return text;
}

/** Read one cookie without pulling in cookie-parser. */export function readCookie(req, name) {
  const header = req.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/**
 * Language for this request, most explicit signal first:
 * ?lang= query -> cookie -> saved profile -> Accept-Language -> English.
 */
export function resolveLang(req) {
  const query = req.query?.lang;
  if (isLang(query)) return String(query).toLowerCase();

  const cookie = readCookie(req, LANG_COOKIE);
  if (isLang(cookie)) return cookie.toLowerCase();

  if (isLang(req.user?.language)) return req.user.language.toLowerCase();

  const accepted = String(req.headers?.['accept-language'] ?? '');
  for (const chunk of accepted.split(',')) {
    const code = chunk.split(';')[0].trim().slice(0, 2).toLowerCase();
    if (CODES.has(code)) return code;
  }

  return DEFAULT_LANG;
}

/** `f` with the language-sensitive helpers bound to `lang`. */
export function localizedFormat(lang) {
  return {
    ...fmt,
    timeAgo: (value) => fmt.timeAgo(value, lang),
    relativeFuture: (value) => fmt.relativeFuture(value, lang),
    fullDate: (value) => fmt.fullDate(value, lang),
    shortDate: (value) => fmt.shortDate(value, lang),
    dayNum: (value) => fmt.dayNum(value, lang),
    monthShort: (value) => fmt.monthShort(value, lang),
    shortDay: (value) => fmt.shortDay(value, lang),
    timeShort: (value) => fmt.timeShort(value, lang),
  };
}

/** Expose `t`, `lang` and the language list to every template. */
export function i18n(req, res, next) {
  const lang = resolveLang(req);
  const t = (key, vars) => translate(lang, key, vars);

  req.lang = lang;
  req.t = t;
  req.getLang = () => lang;

  res.locals.lang = lang;
  res.locals.t = t;
  res.locals.f = localizedFormat(lang);
  res.locals.langs = LANGS;
  res.locals.langName = (code) => LANGS.find((l) => l.code === code)?.native ?? code;
  res.locals.clientStrings = buildClientStrings(t);

  next();
}

export default { LANGS, DEFAULT_LANG, LANG_COOKIE, isLang, translate, resolveLang, i18n };
