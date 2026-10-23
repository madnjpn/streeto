/**
 * Calendar keys for the build contest.
 *
 * Everything is a fixed-width string so plain lexicographic comparison
 * is chronological, exactly like the ISO timestamps used everywhere
 * else in the app:
 *
 *   week  -> "2026-W42"
 *   month -> "2026-10"
 *   year  -> "2026"
 */

const pad = (n) => String(n).padStart(2, '0');

/** ISO-8601 week key (weeks start on Monday, week 1 holds the first Thursday). */
export function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // Mon = 1 ... Sun = 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // move to the Thursday of this week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad(week)}`;
}

/** Monday that starts the given ISO week, or null when the key is malformed. */
export function weekStart(key) {
  const match = /^(\d{4})-W(\d{2})$/.exec(String(key ?? ''));
  if (!match) return null;
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayNum = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dayNum + 1 + (week - 1) * 7);
  return monday;
}

export const monthKey = (date = new Date()) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;

export const yearKey = (date = new Date()) => String(date.getFullYear());

/** The month a week belongs to (by its Monday), e.g. "2026-W42" -> "2026-10". */
export function weekToMonthKey(key) {
  const start = weekStart(key);
  return start ? `${start.getUTCFullYear()}-${pad(start.getUTCMonth() + 1)}` : null;
}

export const currentWeek = () => weekKey();
export const currentMonth = () => monthKey();
export const currentYear = () => yearKey();

/** Human label for a week key, e.g. "Week 42, 2026". */
export function weekLabel(key, lang = 'en') {
  const match = /^(\d{4})-W(\d{2})$/.exec(String(key ?? ''));
  if (!match) return String(key ?? '');
  const week = Number(match[2]);
  return lang === 'ka' ? `${week}-ე კვირა, ${match[1]}` : `Week ${week}, ${match[1]}`;
}

/** Human label for a month key, e.g. "October 2026". */
export function monthLabel(key, lang = 'en') {
  const match = /^(\d{4})-(\d{2})$/.exec(String(key ?? ''));
  if (!match) return String(key ?? '');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return date.toLocaleDateString(lang === 'ka' ? 'ka-GE' : undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export const PERIOD_LABELS = { week: 'Build of the Week', month: 'Build of the Month', year: 'Build of the Year' };

export default {
  weekKey, weekStart, monthKey, yearKey, weekToMonthKey,
  currentWeek, currentMonth, currentYear, weekLabel, monthLabel, PERIOD_LABELS,
};
