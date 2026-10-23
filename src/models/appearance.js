/**
 * Global appearance settings.
 *
 * The site uses two fonts at the same time: one for Latin letters and
 * one for Georgian letters. Both are stored in the database (not a
 * session) so a change in the admin console is visible to every visitor
 * and survives a server restart.
 */
import { all, get, run } from '../db.js';

/** Default Latin pairing: the original STREETO look (condensed + text). */
export const DEFAULT_LATIN = {
  name: 'Oswald / Inter (Default)',
  heading: 'Oswald',
  headingFallback: "'Arial Narrow', 'Haettenschweiler', Impact",
  body: 'Inter',
  bodyFallback: "'Segoe UI', Roboto, 'Helvetica Neue', Arial",
  description: 'The original STREETO look',
};

/** Default Georgian font. */
export const DEFAULT_GEORGIAN = {
  name: 'Noto Sans Georgian',
  family: 'Noto Sans Georgian',
  description: 'Google font designed for Georgian',
};

export const DEFAULT_FONT = { latin: DEFAULT_LATIN, georgian: DEFAULT_GEORGIAN };

/**
 * Build the CSS font stacks.
 *
 * Order matters: the primary Latin family comes first for English, then
 * the Georgian family, and only then the Latin fallbacks. The Georgian
 * family must sit before the fallbacks because common system fonts
 * (notably Segoe UI on Windows) contain Georgian glyphs and would
 * otherwise win every Georgian character. Generic families stay at the
 * very end so they never steal a script.
 */
export function fontStacks(font) {
  const latin = font?.latin || DEFAULT_LATIN;
  const geo = font?.georgian || DEFAULT_GEORGIAN;
  const tail = 'system-ui, sans-serif';
  const head = [`'${latin.heading}'`, `'${geo.family}'`, latin.headingFallback, tail]
    .filter(Boolean)
    .join(', ');
  const body = [`'${latin.body}'`, `'${geo.family}'`, latin.bodyFallback, tail]
    .filter(Boolean)
    .join(', ');
  // Mono (timestamps, counts, month labels): monospace faces lack
  // Georgian, so the Georgian font is inserted just before the generic
  // fallback to catch any Georgian text set in a monospaced context.
  const mono = [
    "'JetBrains Mono'",
    'ui-monospace',
    'SFMono-Regular',
    'Consolas',
    `'${geo.family}'`,
    'monospace',
  ]
    .filter(Boolean)
    .join(', ');
  return { head, body, mono };
}

const FONT_KEY = 'font';

/* The font is read on every request, so keep a short-lived copy to
   avoid a query per page view. Writes clear it immediately. */
let cache = null;
let cacheAt = 0;
const CACHE_MS = 4000;

const str = (v) => (typeof v === 'string' ? v : '');

/* Generic families must never appear in a fallback list: they cover
   both scripts and would shadow the other language's font. Older rows
   were saved before the script split, so scrub them on read too. */
const GENERICS = new Set([
  'system-ui', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy',
  '-apple-system', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded',
]);

const cleanFallback = (value) =>
  String(value || '')
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token && !GENERICS.has(token.replace(/^['"]|['"]$/g, '').toLowerCase()))
    .join(', ');

/** Normalise whatever is in the database into { latin, georgian }. */
function normalize(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;

  // Shape written before the script split: a single heading/body pair.
  if (!parsed.latin && typeof parsed.heading === 'string' && typeof parsed.body === 'string') {
    return {
      latin: {
        ...parsed,
        headingFallback: cleanFallback(parsed.headingFallback),
        bodyFallback: cleanFallback(parsed.bodyFallback),
      },
      georgian: DEFAULT_GEORGIAN,
    };
  }

  const latin = parsed.latin && typeof parsed.latin.heading === 'string' && typeof parsed.latin.body === 'string'
    ? {
      ...parsed.latin,
      headingFallback: cleanFallback(parsed.latin.headingFallback),
      bodyFallback: cleanFallback(parsed.latin.bodyFallback),
    }
    : DEFAULT_LATIN;
  const georgian = parsed.georgian && typeof parsed.georgian.family === 'string' && parsed.georgian.family.trim()
    ? parsed.georgian
    : DEFAULT_GEORGIAN;

  return { latin, georgian };
}

const readFont = () => {
  const row = get('SELECT value FROM settings WHERE key = ?', FONT_KEY);
  if (!row?.value) return null;
  try {
    return normalize(JSON.parse(row.value));
  } catch {
    /* corrupt row - fall back to the default */
    return null;
  }
};

/** The fonts every visitor sees. */
export function getFont() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_MS) return cache;
  cache = readFont() || DEFAULT_FONT;
  cacheAt = now;
  return cache;
}

function write(font) {
  run(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    FONT_KEY,
    JSON.stringify(font),
  );
  cache = null;
  return font;
}

/** Replace one slot ('latin' or 'georgian') and keep the other. */
export function setFontSlot(slot, value) {
  const current = getFont();
  const next = {
    latin: slot === 'latin' ? value : current.latin,
    georgian: slot === 'georgian' ? value : current.georgian,
  };
  return write(next);
}

/** Replace both slots at once. */
export const setFont = (font) =>
  write({
    latin: font.latin && str(font.latin.heading) ? font.latin : DEFAULT_LATIN,
    georgian: font.georgian && str(font.georgian.family) ? font.georgian : DEFAULT_GEORGIAN,
  });

/** Every uploaded custom font, oldest first. */
export const listCustomFonts = () => all('SELECT * FROM custom_fonts ORDER BY id ASC');

/** Store a new uploaded font and return its row. */
export function addCustomFont(font) {
  run(
    `INSERT INTO custom_fonts
       (filename, original_name, mimetype, format, size, family, weight, style, lang, usage)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    font.filename,
    font.originalName || null,
    font.mimetype,
    font.format,
    font.size || 0,
    font.family,
    font.weight,
    font.style,
    font.lang,
    font.usage,
  );
  return get('SELECT * FROM custom_fonts ORDER BY id DESC LIMIT 1');
}

/** Remove a custom font row (the caller deletes the file). */
export function removeCustomFont(id) {
  const row = get('SELECT * FROM custom_fonts WHERE id = ?', id);
  if (!row) return null;
  run('DELETE FROM custom_fonts WHERE id = ?', id);
  return row;
}

export default {
  DEFAULT_FONT,
  DEFAULT_LATIN,
  DEFAULT_GEORGIAN,
  fontStacks,
  getFont,
  setFont,
  setFontSlot,
  listCustomFonts,
  addCustomFont,
  removeCustomFont,
};
