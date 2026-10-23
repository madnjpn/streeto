import fs from 'node:fs';
import path from 'node:path';
import { all, get, run } from '../db.js';
import ka from '../lib/locales/ka.js';
import { PART_KEYS } from '../lib/locales/parts-keys.js';
import { scanKeys } from '../lib/scan-keys.js';

/**
 * The interface dictionary, editable by admins while the site is running.
 *
 * The English source string is the key. The static file
 * src/lib/locales/ka.js seeds the table on boot; after that the database
 * is the truth, so a correction an admin types survives a restart and
 * reaches every page on the next request.
 *
 * A row flagged `deleted` means "this key has no translation" - the
 * English text is used and the seed will not bring the row back.
 */

/** lang -> Map(key -> translation). The hot path for every render. */
const cache = new Map();
/** Returned for a language that has no translations of its own. */
const EMPTY = new Map();

/** Files that are scanned to work out whether a key is used elsewhere. */
const SCAN_DIRS = ['views', 'src'];
/** Never counted as "in use" - they hold the dictionary itself. */
const SCAN_SKIP = new Set([
  'src/lib/locales/ka.js',
  'src/lib/how-it-works-seed.js',
  'src/models/translations.js',
  'src/models/howitworks.js',
  'src/routes/admin.js',
  'views/admin/translations.ejs',
  'views/admin/how-it-works.ejs',
  'views/pages/about.ejs',
]);

const rel = (file) => path.relative(process.cwd(), file).split(path.sep).join('/');

/** Every source file that could hold a translation key. */
function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(full);
      } else if (/\.(ejs|js)$/.test(entry.name) && !SCAN_SKIP.has(rel(full))) {
        out.push(full);
      }
    }
  };
  for (const dir of SCAN_DIRS) walk(path.resolve(dir));
  return out;
}

let sourceTextCache = null;

/** The concatenated source of every scannable file. */
function sourceText() {
  if (sourceTextCache !== null) return sourceTextCache;
  sourceTextCache = sourceFiles()
    .map((file) => {
      try {
        return fs.readFileSync(file, 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
  return sourceTextCache;
}

/** Is this key still used by the code (so its translation must stay)? */
export function isUsedInSource(key) {
  if (!key) return false;
  return sourceText().includes(key);
}

/** Forget the cached source - call it after the code changes. */
export function invalidateSourceScan() {
  sourceTextCache = null;
}

/**
 * Make sure the table exists. A restored backup can be older than the
 * migration that created it, and the process does not reboot after a
 * restore - so the table is created here as well.
 */
function ensureTable() {
  run(`CREATE TABLE IF NOT EXISTS translations (
    lang    TEXT NOT NULL,
    key     TEXT NOT NULL,
    value   TEXT NOT NULL DEFAULT '',
    deleted INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT,
    PRIMARY KEY (lang, key)
  )`);
}

/**
 * Copy the static dictionary into the table. Existing rows are left
 * alone, so admin edits are never overwritten.
 */
export function seed() {
  ensureTable();
  let added = 0;
  let filled = 0;
  // The catalogue terms are keys too. Those with a translation in the
  // shipped dictionary use it; the rest are registered with an empty
  // value, ready for the admin to translate.
  const source = new Map(Object.entries(ka));
  for (const key of PART_KEYS) {
    if (!source.has(key)) source.set(key, '');
  }
  for (const [key, value] of source) {
    if (typeof value !== 'string') continue;
    const info = run(
      `INSERT OR IGNORE INTO translations (lang, key, value, deleted, updated_at)
       VALUES ('ka', ?, ?, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      key,
      value,
    );
    if (info.changes) { added += 1; continue; }
    // A row that is still empty was registered by the code scan, not
    // written by an admin - give it the translation from the file.
    const row = get('SELECT value, deleted FROM translations WHERE lang = ? AND key = ?', 'ka', key);
    if (row && !row.deleted && !row.value && value) {
      run(
        `UPDATE translations SET value = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE lang = 'ka' AND key = ?`,
        value,
        key,
      );
      filled += 1;
    }
  }
  return { added, filled };
}

/** Read the table into the in-memory cache. */
export function load() {
  cache.clear();
  for (const lang of new Set(all('SELECT DISTINCT lang FROM translations').map((r) => r.lang))) {
    const map = new Map();
    // Start from the static file, so a key that was never seeded still
    // has its translation.
    if (lang === 'ka') for (const [key, value] of Object.entries(ka)) map.set(key, value);
    for (const row of all('SELECT key, value, deleted FROM translations WHERE lang = ?', lang)) {
      // The map holds the finished text. A row that was removed, or that
      // the admin cleared, means "show the English" - which is the key
      // itself.
      if (row.deleted || !row.value) map.set(row.key, row.key);
      else map.set(row.key, row.value);
    }
    cache.set(lang, map);
  }
  if (!cache.has('ka')) cache.set('ka', new Map(Object.entries(ka)));
  return cache;
}

/** Seed if needed and load the cache. Safe to call more than once. */
export function init() {
  seed();
  return load();
}

/**
 * Make sure every string in the code has a row in the table.
 *
 * A new feature with new wording is picked up here: the string is
 * registered with an empty value (so the site keeps showing the English)
 * and shows up in the admin's translation list straight away, instead of
 * being forgotten. A row that was removed on purpose is left alone.
 */
export function syncWithCode() {
  const { keys } = scanKeys();
  let added = 0;
  for (const key of keys) {
    const row = get('SELECT deleted FROM translations WHERE lang = ? AND key = ?', 'ka', key);
    if (row) continue;
    const value = typeof ka[key] === 'string' ? ka[key] : '';
    run(
      `INSERT INTO translations (lang, key, value, deleted, updated_at)
       VALUES ('ka', ?, ?, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      key,
      value,
    );
    added += 1;
  }
  if (added) load();
  return { added, found: keys.length };
}

/* ── catching a string the code has never seen ─────────────────── */

const registered = new Set();

/**
 * A string the site asked for that the dictionary does not have. It is
 * registered so the admin can translate it - this is the safety net for
 * wording that comes out of a table or the database rather than a
 * literal in a template.
 */
export function registerMissing(lang, key) {
  if (!key || typeof key !== 'string') return;
  // A message somebody copied out of the running site carries a real
  // name - it is not a string of the site and must not become one.
  if (/@[A-Za-z0-9_]{3,20}[.,\s]/.test(key) && !/\{[a-z]+\}/i.test(key)) return;
  const map = cache.get(lang);
  // Only a language that has a dictionary of its own is managed here -
  // English is the source text and is never registered.
  if (!map || !map.size) return;
  const mark = `${lang}:${key}`;
  if (registered.has(mark)) return;
  registered.add(mark);
  try {
    run(
      `INSERT OR IGNORE INTO translations (lang, key, value, deleted, updated_at)
       VALUES (?, ?, '', 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
      lang,
      key,
    );
  } catch {
    /* the table may be missing on a very old database - not fatal */
  }
  map.set(key, key);
}

/** The live dictionary for a language. */
export function dictionary(lang) {
  if (!cache.size) init();
  return cache.get(lang) || EMPTY;
}

/** Save one translation and make it live immediately. */
export function set(lang, key, value) {
  const clean = String(value ?? '');
  // An empty box means "no translation" - the English text is shown.
  // It is flagged as removed so the seed does not put the file's
  // translation back on the next restart.
  const deleted = clean ? 0 : 1;
  run(
    `INSERT INTO translations (lang, key, value, deleted, updated_at)
     VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(lang, key) DO UPDATE SET value = excluded.value, deleted = excluded.deleted,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    lang,
    key,
    clean,
    deleted,
  );
  const map = cache.get(lang);
  // An empty value means "show the English", which is the key itself.
  if (map) map.set(key, clean || key);
  return clean;
}

/** Drop a translation - the key falls back to English. */
export function remove(lang, key) {
  run(
    `INSERT INTO translations (lang, key, value, deleted, updated_at)
     VALUES (?, ?, '', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(lang, key) DO UPDATE SET value = '', deleted = 1,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    lang,
    key,
  );
  const map = cache.get(lang);
  if (map) map.set(key, key);
}

/** Every key of a language, for the admin list. */
export function list(lang, { q = '', only = '', limit = 2000, offset = 0 } = {}) {
  const needle = String(q || '').trim();
  const where = ['lang = ?'];
  const params = [lang];
  if (needle) {
    where.push('(key LIKE ? OR value LIKE ?)');
    params.push(`%${needle}%`, `%${needle}%`);
  }
  if (only === 'missing') where.push("(deleted = 1 OR value = '')");
  return all(
    `SELECT key, value, deleted FROM translations
      WHERE ${where.join(' AND ')} ORDER BY key LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );
}

/** How many translations exist for a language. */
export function countFor(lang) {
  return get('SELECT COUNT(*) AS n FROM translations WHERE lang = ?', lang)?.n ?? 0;
}

/** How many are still without a Georgian text. */
export function missingCount(lang) {
  return get(
    "SELECT COUNT(*) AS n FROM translations WHERE lang = ? AND (deleted = 1 OR value = '')",
    lang,
  )?.n ?? 0;
}

/**
 * Drop the rows the site does not use any more - usually a message
 * that was copied out of the running site and pasted into the wrong
 * field by mistake. Only the keys that are not in the code, not in the
 * shipped dictionary and not in the manual are removed.
 */
export function removeUnused(used) {
  const rows = all("SELECT key, value FROM translations WHERE lang = 'ka'");
  let removed = 0;
  for (const row of rows) {
    if (used.has(row.key)) continue;
    // A key the admin has translated is kept even when the scanner
    // cannot see it (catalogue terms are used at runtime).
    if (row.value) continue;
    run('DELETE FROM translations WHERE lang = ? AND key = ?', 'ka', row.key);
    removed += 1;
  }
  if (removed) load();
  return removed;
}

/** Keys that have no Georgian translation yet. */
export function missing(lang) {
  return all(
    `SELECT key FROM translations WHERE lang = ? AND (deleted = 1 OR value = '')
      ORDER BY key`,
    lang,
  ).map((row) => row.key);
}

/* ── checking a translation before it is saved ──────────────────── */

const PLACEHOLDER = /\{(\w+)\}/g;
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
/** Tags that never have a closing tag. */
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link']);

/** The {placeholders} a text uses. */
export function placeholdersOf(text) {
  return [...String(text ?? '').matchAll(PLACEHOLDER)].map((m) => m[1]);
}

/**
 * Check a Georgian value against the English key it belongs to.
 *
 * Two things can go wrong and they are not the same:
 *  - a missing {placeholder} silently drops a live value (a name, a
 *    number, the site name) - that is an error;
 *  - different or unbalanced HTML changes how the line looks, and some
 *    keys are rendered without escaping, so a broken tag can break the
 *    page - that is an error too, while a tag the admin chose to leave
 *    out is only a warning.
 *
 * The problems come back as translation keys, so the console can show
 * them in the admin's own language.
 */
export function checkValue(key, value) {
  const source = String(key ?? '');
  const text = String(value ?? '');
  const errors = [];
  const warnings = [];

  // An empty box simply means "not translated yet" - the English text
  // is shown. There is nothing to check.
  if (!text.trim()) return { errors, warnings };

  // 1. placeholders
  const keyPh = placeholdersOf(source);
  const valuePh = placeholdersOf(text);
  for (const name of keyPh) {
    if (!valuePh.includes(name)) {
      errors.push({
        key: 'The translation must keep the {name} placeholder - it is filled in when the page is rendered.',
        vars: { name },
      });
    }
  }
  for (const name of valuePh) {
    if (!keyPh.includes(name)) {
      warnings.push({
        key: 'The English text has no {name} - it will show as plain text.',
        vars: { name },
      });
    }
  }

  // 2. html
  const keyTags = [...source.matchAll(TAG)].map((m) => m[2].toLowerCase()).filter((t) => !VOID_TAGS.has(t));
  const valueTags = [...text.matchAll(TAG)].map((m) => m[2].toLowerCase()).filter((t) => !VOID_TAGS.has(t));

  const open = {};
  const close = {};
  for (const match of text.matchAll(TAG)) {
    const name = match[2].toLowerCase();
    if (VOID_TAGS.has(name)) continue;
    if (match[1] === '/') close[name] = (close[name] || 0) + 1;
    else open[name] = (open[name] || 0) + 1;
  }
  for (const name of new Set([...Object.keys(open), ...Object.keys(close)])) {
    if ((open[name] || 0) !== (close[name] || 0)) {
      errors.push({
        key: 'The {name} tag is not closed - that would break the page.',
        vars: { name: `<${name}>` },
      });
    }
  }

  const missingTags = keyTags.filter((tag) => !valueTags.includes(tag));
  if (missingTags.length) {
    const list = [...new Set(missingTags)].map((tag) => `<${tag}>`).join(', ');
    warnings.push({
      key: 'The English text uses {name} - the bold or italic part will be lost.',
      vars: { name: list },
    });
  }

  return { errors, warnings };
}

/** Fill a problem's {placeholders} so it can be shown on the server. */
export function fillProblem(problem) {
  return String(problem.key).replace(
    /\{(\w+)\}/g,
    (match, name) =>
      Object.prototype.hasOwnProperty.call(problem.vars || {}, name) ? String(problem.vars[name]) : match,
  );
}

export default {
  seed, load, init, dictionary, set, remove, list, countFor, missing, missingCount,
  isUsedInSource, invalidateSourceScan, checkValue, placeholdersOf, fillProblem,
  syncWithCode, registerMissing, removeUnused,
};
