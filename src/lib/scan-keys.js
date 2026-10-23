import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../config.js';

/**
 * Finds every translatable string in the code.
 *
 * The interface keys are the English source strings themselves, so the
 * only reliable way to know the full list is to read the code. This
 * scans the templates, the server and the browser scripts for the
 * places a string is handed to `t()` and for the small tables of labels
 * that are filled in at render time.
 *
 * It is a safety net: a new feature with new wording is picked up on
 * the next boot and shows up in the admin's translation list, instead of
 * quietly staying in English forever.
 */

const SKIP_DIRS = new Set(['node_modules', '.git', 'data', 'uploads', 'backups']);
const SCAN_DIRS = ['views', 'src', 'public/js'];
/** Files that are not code - the dictionary and the scanner itself. */
const SKIP_FILES = new Set([
  path.join('src', 'lib', 'locales', 'ka.js'),
  path.join('src', 'lib', 'scan-keys.js'),
]);

/** Every file that could hold a string. */
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
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        walk(full);
      } else if (/\.(ejs|js)$/.test(entry.name)) {
        if (SKIP_FILES.has(path.relative(ROOT, full))) continue;
        out.push(full);
      }
    }
  };
  for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir));
  return out;
}

/**
 * Read a quoted string literal starting at `start` (the quote itself).
 * Handles the escaped quote and the escaped backslash.
 */
function readLiteral(text, start) {
  const quote = text[start];
  let out = '';
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      const next = text[i + 1];
      if (next === quote || next === '\\') {
        out += next;
        i += 2;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }
    if (ch === quote) return out;
    if (ch === '\n') return null;
    out += ch;
    i += 1;
  }
  return null;
}

/** All the string literals a source file hands to the translator. */
function keysInFile(file, text) {
  const keys = new Set();
  const add = (value) => {
    if (typeof value === 'string' && value.trim()) keys.add(value);
  };

  // 1. t('...') and t("...") - the usual way a string is translated.
  for (const match of text.matchAll(/(?<![A-Za-z0-9_$.])t\(\s*(['"])/g)) {
    const value = readLiteral(text, match.index + match[0].length - 1);
    add(value);
  }

  // 2. error messages: errors.title = 'Give the meetup a title.'
  for (const match of text.matchAll(/errors\.\w+\s*=\s*(['"])/g)) {
    const value = readLiteral(text, match.index + match[0].length - 1);
    add(value);
  }

  // 3. flash messages: req.flash('success', 'Registration certificate saved.')
  //    The type is the first argument; the message (the key) is the second.
  for (const match of text.matchAll(/req\.flash\(\s*['"][^'"]*['"]\s*,\s*(['"])/g)) {
    const value = readLiteral(text, match.index + match[0].length - 1);
    add(value);
  }

  // 4. the small label tables: { value: 'engine', label: 'Engine' }
  for (const match of text.matchAll(/\blabel:\s*(['"])/g)) {
    const value = readLiteral(text, match.index + match[0].length - 1);
    add(value);
  }

  // 5. client-side flash messages: flash('Drop a pin or use your GPS first.', 'warning')
  //    The message is the first argument.
  for (const match of text.matchAll(/(?<![A-Za-z0-9_$.])flash\(\s*(['"])/g)) {
    const value = readLiteral(text, match.index + match[0].length - 1);
    add(value);
  }

  // 6. the browser string list (client-strings.js) is an array of keys,
  //    one quoted string per line.
  if (file.endsWith(path.join('lib', 'client-strings.js'))) {
    for (const match of text.matchAll(/^\s*'((?:[^'\\]|\\.)*)'/gm)) {
      add(match[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
    }
  }

  return keys;
}

/**
 * Every translatable string in the code.
 * @returns {{ keys: string[], files: number }}
 */
export function scanKeys() {
  const keys = new Set();
  const files = sourceFiles();
  for (const file of files) {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const key of keysInFile(file, text)) keys.add(key);
  }
  return { keys: [...keys].sort(), files: files.length };
}

export default { scanKeys };
