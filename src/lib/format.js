import config from '../config.js';

/**
 * Presentation helpers exposed to EJS templates. EJS escapes with
 * <%= %>, and anything that must render markup goes through
 * formatText, which escapes first and then re-adds safe links.
 */

/** HTML-escape a value. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Turn plain text into safe HTML: escaped, newlines to <br>, and
 * http(s) URLs / #hashtags made clickable. Never returns raw user HTML.
 */
export function formatText(value) {
  const escaped = escapeHtml(value);

  // Links are pulled out first and put back at the end, so a #tag or an
  // @name inside a link is left alone.
  const links = [];
  let text = escaped.replace(
    /\b(https?:\/\/[^\s<]+[^\s<.,:;"')\]}])/g,
    (url) => {
      links.push(url);
      return `\u0000${links.length - 1}\u0000`;
    },
  );

  text = text
    .replace(/(^|\s)#([A-Za-z0-9_]{2,30})/g, (_m, lead, tag) => `${lead}<a class="link" href="/search?q=%23${tag}">#${tag}</a>`)
    .replace(/(^|\s)@([A-Za-z0-9_]{3,20})\b/g, (_m, lead, name) => `${lead}<a class="mention" href="/u/${name}">@${name}</a>`)
    .replace(/\n/g, '<br>');

  return text.replace(/\u0000(\d+)\u0000/g, (_m, index) => {
    const url = links[Number(index)];
    return `<a class="link" href="${url}" rel="noopener noreferrer nofollow" target="_blank">${url}</a>`;
  });
}

/** A deterministic hue (0-359) derived from a string. */
export function hueOf(value) {
  let hash = 5381;
  const text = String(value ?? '?');
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

/** First two characters of a name, upper-cased. */
export function initials(value) {
  const text = String(value ?? '?').trim();
  const parts = text.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  const clean = text.replace(/[^\p{L}\p{N}]/gu, '');
  return (clean || '?').slice(0, 2).toUpperCase();
}

/** Public URL for a user's avatar, or null to use generated initials. */
export const avatarUrl = (user) => (user?.avatar ? `${config.uploadUrl}/${user.avatar}` : null);

export const displayName = (user) => user?.display_name || user?.username || 'Unknown';

/** The business name stored while a provider has no verified listing yet. */
export const PROVIDER_PLACEHOLDER = 'Provides Service';

/**
 * The business name to show. The placeholder is a stored value, so it has
 * to be translated on the way out - a provider without a verified listing
 * still carries the generic badge.
 */
export const providerName = (value, t) => {
  const name = String(value ?? '').trim();
  if (!name || name === PROVIDER_PLACEHOLDER) return t('Service provider');
  return name;
};

/** Parse a stored ISO timestamp into a Date (safe for nulls). */
export function toDate(value) {
  if (!value) return null;
  const str = value instanceof Date ? value.toISOString() : String(value).trim();
  // Normalize SQLite "YYYY-MM-DD HH:MM:SS[.fff]" -> ISO "YYYY-MM-DDTHH:MM:SS[.fff]Z"
  const iso = str.includes('T') ? str : str.replace(' ', 'T');
  // If no timezone suffix, assume UTC (DB stores UTC)
  const withZ = /Z$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : iso + 'Z';
  const date = new Date(withZ);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "3m ago", "5h ago", "12 Mar" ... `lang` picks the unit words. */
const TIME_UNITS = {
  en: { s: 's', m: 'm', h: 'h', d: 'd', w: 'w', mo: 'mo', y: 'y', ago: 'ago', now: 'just now' },
  ka: { s: 'წმ', m: 'წთ', h: 'სთ', d: 'დღ', w: 'კვ', mo: 'თვ', y: 'წ', ago: 'წინ', now: 'ახლახან' },
};

export function timeAgo(value, lang = 'en') {
  const units = TIME_UNITS[lang] || TIME_UNITS.en;
  const locale = lang === 'ka' ? 'ka-GE' : undefined;
  const date = toDate(value);
  if (!date) return '';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return units.now;
  const table = [
    [60, 'm'], [60, 'h'], [24, 'd'], [7, 'w'], [4.35, 'mo'], [12, 'y'],
  ];
  let value_ = seconds;
  let unit = 's';
  for (const [factor, label] of table) {
    if (value_ < factor) break;
    value_ = value_ / factor;
    unit = label;
  }
  if (unit === 'w' && value_ >= 4.35) return date.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  return `${Math.max(1, Math.floor(value_))}${units[unit]} ${units.ago}`;
}

/** Full local timestamp, e.g. "Fri 12 Sep 2026, 21:40". */
export function fullDate(value, lang = 'en') {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleString(lang === 'ka' ? 'ka-GE' : undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Compact date for cards. */
export function shortDate(value, lang = 'en') {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleDateString(lang === 'ka' ? 'ka-GE' : undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** Day of the month ("21") in the chosen locale. */
export function dayNum(value, lang = 'en') {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleDateString(lang === 'ka' ? 'ka-GE' : undefined, { day: '2-digit' });
}

/** Short month name ("SEP") in the chosen locale. */
export function monthShort(value, lang = 'en') {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleDateString(lang === 'ka' ? 'ka-GE' : undefined, { month: 'short' });
}

/** "21 Sep" - day plus short month, for the wall sidebar. */
export function shortDay(value, lang = 'en') {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleDateString(lang === 'ka' ? 'ka-GE' : undefined, { day: '2-digit', month: 'short' });
}

/** "21:40" local clock time in the chosen locale. */
export function timeShort(value, lang = 'en') {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleTimeString(lang === 'ka' ? 'ka-GE' : undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Value for an <input type="datetime-local">. */
export function toLocalInput(value) {
  const date = toDate(value);
  if (!date) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "in 3 days" / "2 hours ago" for meetup start times. */
const FUTURE_UNITS = {
  en: {
    minute: { noun: 'minute', plural: 's' },
    hour: { noun: 'hour', plural: 's' },
    day: { noun: 'day', plural: 's' },
    week: { noun: 'week', plural: 's' },
    month: { noun: 'month', plural: 's' },
  },
  ka: {
    minute: { noun: 'წუთი', in: 'წუთში' },
    hour: { noun: 'საათი', in: 'საათში' },
    day: { noun: 'დღე', in: 'დღეში' },
    week: { noun: 'კვირა', in: 'კვირაში' },
    month: { noun: 'თვე', in: 'თვეში' },
  },
};

export function relativeFuture(value, lang = 'en') {
  const date = toDate(value);
  if (!date) return '';
  const diff = date.getTime() - Date.now();
  const abs = Math.abs(diff);
  const units = [
    [1000 * 60, 'minute'], [1000 * 60 * 60, 'hour'], [1000 * 60 * 60 * 24, 'day'],
    [1000 * 60 * 60 * 24 * 7, 'week'], [1000 * 60 * 60 * 24 * 30, 'month'],
  ];
  let divisor = 1000 * 60;
  let label = 'minute';
  for (const [ms, name] of units) {
    if (abs >= ms) {
      divisor = ms;
      label = name;
    }
  }
  const count = Math.max(1, Math.round(abs / divisor));
  const words = (FUTURE_UNITS[lang] || FUTURE_UNITS.en)[label];

  if (lang === 'ka') {
    return diff >= 0 ? `${count} ${words.in}` : `${count} ${words.noun} წინ`;
  }
  const phrase = `${count} ${words.noun}${count === 1 ? '' : words.plural}`;
  return diff >= 0 ? `in ${phrase}` : `${phrase} ago`;
}

export const pluralize = (count, singular, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

export function truncate(value, max = 140) {
  const text = String(value ?? '').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}\u2026`;
}

/** Coarse distance in km, used for meetup lists. */
export function distanceKm(a, b) {
  if (!a || !b || a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const PRIVACY_LABELS = {
  open: 'Open',
  private: 'Private',
  invite: 'Invite only',
};

export const PRIVACY_HINTS = {
  open: 'Anyone can see it and join right away.',
  private: 'Anyone can see it, but the host approves who gets in.',
  invite: 'Hidden. Only people the host invites can see it.',
};

export const js = (value) => JSON.stringify(value ?? null).replace(/</g, '\\u003c');

/** Human readable byte count, for the admin backup list. */
export function fileSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size < 10 && unit > 0 ? size.toFixed(1) : Math.round(size)} ${units[unit]}`;
}

export default {
  escapeHtml,
  formatText,
  hueOf,
  initials,
  avatarUrl,
  displayName,
  timeAgo,
  fullDate,
  shortDate,
  toLocalInput,
  dayNum,
  monthShort,
  shortDay,
  timeShort,
  relativeFuture,
  pluralize,
  truncate,
  distanceKm,
  fileSize,
  PRIVACY_LABELS,
  PRIVACY_HINTS,
  js,
};
