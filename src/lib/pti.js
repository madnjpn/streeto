import config from '../config.js';

/**
 * Annual technical inspection lookup (pti.ge).
 *
 * The public page takes the number plate in `?govNum=` and renders one of
 * two deadline blocks:
 *
 *   ინსპექტირებულია          -> inspected / valid
 *   ვადაგადაცილებულია        -> overdue / expired
 *
 * Below the title it prints the plate, the inspection date and the expiry
 * date in Georgian. We keep the dates as plain `YYYY-MM-DD` strings and
 * decide red/green at render time, so a stored "valid" result naturally
 * turns red after its expiry date without another network call.
 */

const MONTHS = new Map([
  ['იანვარი', 1],
  ['თებერვალი', 2],
  ['მარტი', 3],
  ['აპრილი', 4],
  ['მაისი', 5],
  ['ივნისი', 6],
  ['ივლისი', 7],
  ['აგვისტო', 8],
  ['სექტემბერი', 9],
  ['ოქტომბერი', 10],
  ['ნოემბერი', 11],
  ['დეკემბერი', 12],
]);

const GEORGIA_TZ = 'Asia/Tbilisi';

/** Strip punctuation/spaces so `JP-004-AN` becomes `JP004AN`. */
export function normalizePlate(value) {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
}

/** Public pti.ge lookup URL for a plate (or null when there is no plate). */
export function ptiUrl(plate) {
  const normalized = normalizePlate(plate);
  if (!normalized) return null;
  const base = String(config.ptiBaseUrl || 'https://pti.ge/');
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}govNum=${encodeURIComponent(normalized)}`;
}

/** `YYYY-MM-DD` for "today" in Georgia, independent of server timezone. */
export function georgiaDate(now = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: GEORGIA_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
}

const decodeEntities = (value) =>
  String(value ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#160;/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'");

const textOf = (value) =>
  decodeEntities(String(value ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

/** Parse a Georgian date such as "29 დეკემბერი 2024 23:59:59". */
export function parseGeorgianDate(value) {
  const text = textOf(value);
  if (!text) return null;

  const named = text.match(/(\d{1,2})\s+([^\s0-9]+)\s+(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/);
  if (named) {
    const day = Number(named[1]);
    const month = MONTHS.get(named[2].replace(/[^\p{L}]/gu, ''));
    const year = Number(named[3]);
    if (month && day >= 1 && day <= 31) {
      const pad = (n) => String(n).padStart(2, '0');
      return `${year}-${pad(month)}-${pad(day)}`;
    }
  }

  const numeric = text.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (numeric) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${numeric[3]}-${pad(Number(numeric[2]))}-${pad(Number(numeric[1]))}`;
  }
  return null;
}

/**
 * Read the deadline block out of a pti.ge response.
 * Returns { status, plate, inspectedAt, expiresAt }.
 */
export function parsePtiHtml(html) {
  const source = String(html ?? '');
  const titleMatch = source.match(
    /<div[^>]*class="[^"]*deadlineTitle[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  );
  const title = textOf(titleMatch?.[1]);

  let status = 'unknown';
  if (title.includes('ვადაგადაცილებულია')) status = 'expired';
  else if (title.includes('ინსპექტირებულია')) status = 'valid';

  const plateMatch = source.match(/სახელმწიფო ნომერი:\s*([^<]+)/);
  const inspectedMatch = source.match(/ინსპექტირების თარიღი:\s*([^<]+)/);
  const expiresMatch = source.match(/მოქმედების ვადა:\s*([^<]+)/);

  const plate = normalizePlate(plateMatch?.[1]) || null;
  const inspectedAt = parseGeorgianDate(inspectedMatch?.[1]);
  const expiresAt = parseGeorgianDate(expiresMatch?.[1]);

  // Some pti.ge layouts may move the title, so fall back to the icon only
  // when the result fields are present. Error/login pages have neither.
  if (status === 'unknown' && source.includes('ptiTextBG')) {
    if (/icon-checkmark-circle2/.test(source)) status = 'valid';
    else if (/icon-cancel-circle2/.test(source)) status = 'expired';
  }

  return { status, plate, inspectedAt, expiresAt };
}

/**
 * Fetch and parse one pti.ge page. Network/HTTP failures become an
 * `unknown` result rather than throwing, so a save is never blocked by the
 * external service.
 */
export async function lookupPti(plate, { fetchImpl = fetch, timeoutMs = config.ptiTimeoutMs } = {}) {
  const normalized = normalizePlate(plate);
  const checkedAt = new Date().toISOString();
  if (!normalized) {
    return { status: 'missing', plate: null, inspectedAt: null, expiresAt: null, checkedAt };
  }
  if (!config.ptiLookup) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(500, Number(timeoutMs) || 4000));

  try {
    const response = await fetchImpl(ptiUrl(normalized), {
      signal: controller.signal,
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'ka,en;q=0.8',
        'user-agent': 'Streeto/1.0 (+https://streeto.net)',
      },
    });
    if (!response.ok) {
      return { status: 'unknown', plate: normalized, inspectedAt: null, expiresAt: null, checkedAt, error: `HTTP ${response.status}` };
    }
    const html = await response.text();
    const parsed = parsePtiHtml(html);
    return {
      ...parsed,
      plate: parsed.plate || normalized,
      checkedAt,
    };
  } catch (error) {
    return {
      status: 'unknown',
      plate: normalized,
      inspectedAt: null,
      expiresAt: null,
      checkedAt,
      error: error?.name === 'AbortError' ? 'timeout' : error?.message || 'lookup failed',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** True when a stored snapshot belongs to the current plate and is fresh. */
export function ptiNeedsCheck(row, now = Date.now()) {
  if (!row) return false;
  const plate = normalizePlate(row.number_plate);
  if (!plate) return false;
  if (normalizePlate(row.pti_plate) !== plate) return true;
  if (!row.pti_checked_at) return true;

  const checked = new Date(row.pti_checked_at).getTime();
  if (!Number.isFinite(checked)) return true;
  const hours = row.pti_status === 'unknown' ? 1 : config.ptiRefreshHours;
  return now - checked >= Math.max(1, hours) * 60 * 60 * 1000;
}

/**
 * View model for the badge. `status` is derived now (not when the lookup
 * ran), so a valid inspection turns red automatically after its expiry.
 */
export function ptiState(row, now = new Date()) {
  if (!row) return { status: 'missing', plate: null };
  // Builds linked to a My Ride vehicle can inherit the inspection snapshot
  // even when the plate is only stored on the vehicle. The plate itself is
  // never printed on a public page - only the status and dates are.
  const plate = normalizePlate(row.number_plate) || normalizePlate(row.pti_plate);
  if (!plate) return { status: 'missing', plate: null };

  const known = row.pti_status === 'valid' || row.pti_status === 'expired';
  if (!known || normalizePlate(row.pti_plate) !== plate) {
    return {
      status: 'unknown',
      plate,
      inspectedAt: null,
      expiresAt: null,
      checkedAt: row.pti_checked_at || null,
      url: ptiUrl(plate),
    };
  }

  const expiresAt = row.pti_expires_at ? String(row.pti_expires_at).slice(0, 10) : null;
  let status = row.pti_status;
  if (expiresAt) {
    status = expiresAt < georgiaDate(now) ? 'expired' : 'valid';
  }

  return {
    status,
    plate,
    inspectedAt: row.pti_inspected_at || null,
    expiresAt,
    checkedAt: row.pti_checked_at || null,
    url: ptiUrl(plate),
  };
}

export default {
  normalizePlate,
  ptiUrl,
  georgiaDate,
  parseGeorgianDate,
  parsePtiHtml,
  lookupPti,
  ptiNeedsCheck,
  ptiState,
};
