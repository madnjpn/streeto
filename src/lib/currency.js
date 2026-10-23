import config from '../config.js';
import { readCookie } from './i18n.js';

/**
 * Two currencies, GEL and USD, for every price on the site.
 *
 * A seller picks the currency they are quoting in; that currency is
 * stored next to the amount, so the figure they typed is never mangled.
 * A visitor picks the currency they want to *read* prices in, and every
 * amount is converted on the fly with the reference rate in config
 * (config.usdToGel), so USD -> GEL and GEL -> USD both just work.
 */

/** Cookie that remembers a visitor's currency (mirrors language/theme). */
export const CURRENCY_COOKIE = 'streeto.currency';
export const CURRENCY_COOKIE_MAX_AGE = 1000 * 60 * 60 * 24 * 365;

/** The currencies, in switcher order. Labels are English source strings. */
export const CURRENCIES = [
  { code: 'GEL', symbol: '₾', label: 'Georgian lari' },
  { code: 'USD', symbol: '$', label: 'US dollar' },
];

export const DEFAULT_CURRENCY = 'GEL';

const CODES = new Set(CURRENCIES.map((currency) => currency.code));

/** Normalise + validate a code ('gel' / ' usd ' -> 'GEL' / 'USD'). */
export function normalizeCurrency(code) {
  const up = String(code ?? '').trim().toUpperCase();
  return CODES.has(up) ? up : null;
}

export const isCurrency = (code) => normalizeCurrency(code) !== null;

export const currencyOf = (code) =>
  CURRENCIES.find((currency) => currency.code === normalizeCurrency(code)) ?? CURRENCIES[0];

/**
 * Currency for this request, most explicit signal first:
 * ?currency= query -> cookie -> saved profile -> GEL.
 */
export function resolveCurrency(req) {
  const query = normalizeCurrency(req.query?.currency);
  if (query) return query;

  const cookie = normalizeCurrency(readCookie(req, CURRENCY_COOKIE));
  if (cookie) return cookie;

  return normalizeCurrency(req.user?.currency) ?? DEFAULT_CURRENCY;
}

/**
 * Convert an amount from one currency to another at the reference rate.
 * Prices are whole units, so the result is rounded to a whole number.
 */
export function convert(amount, from, to) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;

  const src = normalizeCurrency(from) ?? DEFAULT_CURRENCY;
  const dst = normalizeCurrency(to) ?? DEFAULT_CURRENCY;
  if (src === dst) return Math.round(n);

  const rate = config.usdToGel;
  const gel = src === 'USD' ? n * rate : n;
  const out = dst === 'USD' ? gel / rate : gel;
  return Math.round(out);
}

/** Format a whole amount in a currency: '25,000 ₾' or '$9,259'. */
export function format(amount, currency) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  const c = currencyOf(currency);
  const digits = new Intl.NumberFormat('en-US').format(Math.round(n));
  return c.code === 'USD' ? `$${digits}` : `${digits} ₾`;
}

export default {
  CURRENCY_COOKIE,
  CURRENCY_COOKIE_MAX_AGE,
  CURRENCIES,
  DEFAULT_CURRENCY,
  isCurrency,
  normalizeCurrency,
  currencyOf,
  resolveCurrency,
  convert,
  format,
};
