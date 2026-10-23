import { all } from '../db.js';
import { scanKeys } from './scan-keys.js';
import ka from './locales/ka.js';
import { PART_KEYS } from './locales/parts-keys.js';

/**
 * The strings the site really uses.
 *
 * Three places hold a translatable string:
 *  - the code (templates, the server, the browser scripts),
 *  - the manual, whose sections and lines live in the database,
 *  - the shipped dictionary, which keeps the wording of a string even
 *    after the feature that used it is gone.
 *
 * Anything outside these is a leftover - usually a message that was
 * copied out of the running site and pasted somewhere by mistake, which
 * puts a real name into the key.
 */
export function usedKeys() {
  const keys = new Set(scanKeys().keys);
  for (const key of Object.keys(ka)) keys.add(key);
  // The catalogue terms are used at runtime, not written in a t() call.
  for (const key of PART_KEYS) keys.add(key);
  for (const row of all('SELECT heading FROM how_sections')) keys.add(row.heading);
  for (const row of all('SELECT body FROM how_blocks')) keys.add(row.body);
  return keys;
}

/** The strings of the manual - they are edited in their own console. */
export function manualKeys() {
  const keys = new Set();
  for (const row of all('SELECT heading FROM how_sections')) keys.add(row.heading);
  for (const row of all('SELECT body FROM how_blocks')) keys.add(row.body);
  return keys;
}

/**
 * A key that looks like a message somebody copied out of the running
 * site: it carries a real name instead of a placeholder.
 */
export function looksCopied(key, usernames = null) {
  const text = String(key ?? '');
  if (!/@/.test(text)) return false;
  const names = usernames || all('SELECT username FROM users').map((row) => row.username);
  return names.some((name) => text.includes(`@${name}`));
}

export default { usedKeys, manualKeys, looksCopied };
