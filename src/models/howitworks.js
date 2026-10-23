import { all, get, run } from '../db.js';
import { HOW_IT_WORKS_SEED } from '../lib/how-it-works-seed.js';
import * as translations from './translations.js';

/**
 * The "How it works" page, editable by admins while the site is running.
 *
 * Every heading and every block stores the English source text, which is
 * also the translation key. When a line is deleted the Georgian
 * translation that belonged to it goes with it - unless the same English
 * text is still used somewhere else in the app, in which case the
 * translation has to stay.
 */

const LANGS = ['ka'];

/** Config key that records the manual has already been seeded once. */
const SEED_MARKER = 'how_it_works_seeded';

/** Every section with its blocks, in order. */
export function sections() {
  const rows = all('SELECT * FROM how_sections ORDER BY position, id');
  const blocks = all('SELECT * FROM how_blocks ORDER BY position, id');
  const bySection = new Map();
  for (const block of blocks) {
    if (!bySection.has(block.section_id)) bySection.set(block.section_id, []);
    bySection.get(block.section_id).push(block);
  }
  return rows.map((section) => ({ ...section, blocks: bySection.get(section.id) || [] }));
}

/** Every English key the page currently uses. */
export function usedKeys() {
  const keys = [];
  for (const section of sections()) {
    keys.push(section.heading);
    for (const block of section.blocks) keys.push(block.body);
  }
  return keys;
}

/** Make sure the tables exist (a restored backup can predate them). */
function ensureTables() {
  run(`CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`);
  run(`CREATE TABLE IF NOT EXISTS how_sections (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    icon     TEXT NOT NULL DEFAULT 'bolt',
    heading  TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0
  )`);
  run(`CREATE TABLE IF NOT EXISTS how_blocks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL REFERENCES how_sections(id) ON DELETE CASCADE,
    kind       TEXT NOT NULL DEFAULT 'p',
    body       TEXT NOT NULL,
    position   INTEGER NOT NULL DEFAULT 0
  )`);
  run('CREATE INDEX IF NOT EXISTS how_blocks_section ON how_blocks(section_id, position)');
}

/**
 * Put the starting content in place the first time the page is opened.
 *
 * A marker in the config table records that the page has been seeded, so
 * an admin who deletes every single section does not get them all back
 * on the next restart.
 */
export function seed() {
  ensureTables();
  if (get('SELECT value FROM config WHERE key = ?', SEED_MARKER)) return 0;
  const count = get('SELECT COUNT(*) AS n FROM how_sections')?.n ?? 0;
  if (count) {
    run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', SEED_MARKER, '1');
    return 0;
  }
  let position = 0;
  for (const section of HOW_IT_WORKS_SEED) {
    const info = run(
      'INSERT INTO how_sections (icon, heading, position) VALUES (?, ?, ?)',
      section.icon || 'bolt',
      section.heading,
      position,
    );
    let blockPosition = 0;
    for (const block of section.blocks || []) {
      run(
        'INSERT INTO how_blocks (section_id, kind, body, position) VALUES (?, ?, ?, ?)',
        info.lastInsertRowid,
        block.kind === 'li' ? 'li' : 'p',
        block.body,
        blockPosition,
      );
      blockPosition += 1;
    }
    position += 1;
  }
  run('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)', SEED_MARKER, '1');
  return position;
}

/* ── writing ────────────────────────────────────────────────────── */

const cleanText = (value, max = 4000) => String(value ?? '').trim().slice(0, max);

/**
 * Drop the Georgian translation of a key that is no longer on the page.
 * The translation only goes when nothing else in the app uses the same
 * English text.
 */
function releaseTranslation(key) {
  if (!key) return;
  if (usedKeys().includes(key)) return;
  if (translations.isUsedInSource(key)) return;
  for (const lang of LANGS) translations.remove(lang, key);
}

export function addSection({ icon, heading }) {
  const text = cleanText(heading, 160);
  if (!text) return null;
  const position = (get('SELECT MAX(position) AS p FROM how_sections')?.p ?? -1) + 1;
  const info = run(
    'INSERT INTO how_sections (icon, heading, position) VALUES (?, ?, ?)',
    cleanText(icon, 40) || 'bolt',
    text,
    position,
  );
  return get('SELECT * FROM how_sections WHERE id = ?', info.lastInsertRowid);
}

export function updateSection(id, { icon, heading }) {
  const section = get('SELECT * FROM how_sections WHERE id = ?', id);
  if (!section) return null;
  const text = heading === undefined ? section.heading : cleanText(heading, 160);
  run(
    'UPDATE how_sections SET icon = ?, heading = ? WHERE id = ?',
    icon === undefined ? section.icon : cleanText(icon, 40) || 'bolt',
    text || section.heading,
    id,
  );
  if (text && text !== section.heading) releaseTranslation(section.heading);
  return get('SELECT * FROM how_sections WHERE id = ?', id);
}

export function deleteSection(id) {
  const section = get('SELECT * FROM how_sections WHERE id = ?', id);
  if (!section) return false;
  const blocks = all('SELECT body FROM how_blocks WHERE section_id = ?', id);
  run('DELETE FROM how_blocks WHERE section_id = ?', id);
  run('DELETE FROM how_sections WHERE id = ?', id);
  releaseTranslation(section.heading);
  for (const block of blocks) releaseTranslation(block.body);
  return true;
}

export function addBlock(sectionId, { kind, body }) {
  const section = get('SELECT id FROM how_sections WHERE id = ?', sectionId);
  if (!section) return null;
  const text = cleanText(body, 4000);
  if (!text) return null;
  const position = (get('SELECT MAX(position) AS p FROM how_blocks WHERE section_id = ?', sectionId)?.p ?? -1) + 1;
  const info = run(
    'INSERT INTO how_blocks (section_id, kind, body, position) VALUES (?, ?, ?, ?)',
    sectionId,
    kind === 'li' ? 'li' : 'p',
    text,
    position,
  );
  return get('SELECT * FROM how_blocks WHERE id = ?', info.lastInsertRowid);
}

export function updateBlock(id, { kind, body }) {
  const block = get('SELECT * FROM how_blocks WHERE id = ?', id);
  if (!block) return null;
  const text = body === undefined ? block.body : cleanText(body, 4000);
  run(
    'UPDATE how_blocks SET kind = ?, body = ? WHERE id = ?',
    kind === undefined ? block.kind : (kind === 'li' ? 'li' : 'p'),
    text || block.body,
    id,
  );
  if (text && text !== block.body) releaseTranslation(block.body);
  return get('SELECT * FROM how_blocks WHERE id = ?', id);
}

export function deleteBlock(id) {
  const block = get('SELECT * FROM how_blocks WHERE id = ?', id);
  if (!block) return false;
  run('DELETE FROM how_blocks WHERE id = ?', id);
  releaseTranslation(block.body);
  return true;
}

/** Move a block up or down inside its section. */
export function moveBlock(id, direction) {
  const block = get('SELECT * FROM how_blocks WHERE id = ?', id);
  if (!block) return false;
  const neighbour = get(
    `SELECT * FROM how_blocks WHERE section_id = ? AND position ${direction === 'up' ? '<' : '>'} ?
      ORDER BY position ${direction === 'up' ? 'DESC' : 'ASC'} LIMIT 1`,
    block.section_id,
    block.position,
  );
  if (!neighbour) return false;
  run('UPDATE how_blocks SET position = ? WHERE id = ?', neighbour.position, block.id);
  run('UPDATE how_blocks SET position = ? WHERE id = ?', block.position, neighbour.id);
  return true;
}

/** Move a section up or down. */
export function moveSection(id, direction) {
  const section = get('SELECT * FROM how_sections WHERE id = ?', id);
  if (!section) return false;
  const neighbour = get(
    `SELECT * FROM how_sections WHERE position ${direction === 'up' ? '<' : '>'} ?
      ORDER BY position ${direction === 'up' ? 'DESC' : 'ASC'} LIMIT 1`,
    section.position,
  );
  if (!neighbour) return false;
  run('UPDATE how_sections SET position = ? WHERE id = ?', neighbour.position, section.id);
  run('UPDATE how_sections SET position = ? WHERE id = ?', section.position, neighbour.id);
  return true;
}

/**
 * Move a section to a place in the list - used by the drag and drop in
 * the editor.
 */
export function moveSectionTo(id, index) {
  const sections = all('SELECT id FROM how_sections ORDER BY position, id');
  const from = sections.findIndex((row) => row.id === id);
  if (from === -1) return false;
  const to = Math.max(0, Math.min(sections.length - 1, Number(index) || 0));
  if (to === from) return false;
  const ids = sections.map((row) => row.id);
  ids.splice(from, 1);
  ids.splice(to, 0, id);
  ids.forEach((sectionId, index_) => {
    run('UPDATE how_sections SET position = ? WHERE id = ?', index_, sectionId);
  });
  return true;
}

/** Move a line to a place inside its section - or into another one. */
export function moveBlockTo(id, index, sectionId = null) {
  const block = get('SELECT * FROM how_blocks WHERE id = ?', id);
  if (!block) return false;
  const target = Number(sectionId) || block.section_id;
  if (target !== block.section_id) {
    run('UPDATE how_blocks SET section_id = ? WHERE id = ?', target, id);
  }
  const blocks = all('SELECT id FROM how_blocks WHERE section_id = ? ORDER BY position, id', target);
  const from = blocks.findIndex((row) => row.id === id);
  if (from === -1) return false;
  const to = Math.max(0, Math.min(blocks.length - 1, Number(index) || 0));
  if (to === from) return false;
  const ids = blocks.map((row) => row.id);
  ids.splice(from, 1);
  ids.splice(to, 0, id);
  ids.forEach((blockId, index_) => {
    run('UPDATE how_blocks SET position = ? WHERE id = ?', index_, blockId);
  });
  return true;
}

/** Renumber everything so the positions stay tidy after an edit. */
function normalise() {
  const sections = all('SELECT id FROM how_sections ORDER BY position, id');
  sections.forEach((section, index) => {
    run('UPDATE how_sections SET position = ? WHERE id = ?', index, section.id);
    const blocks = all('SELECT id FROM how_blocks WHERE section_id = ? ORDER BY position, id', section.id);
    blocks.forEach((block, blockIndex) => {
      run('UPDATE how_blocks SET position = ? WHERE id = ?', blockIndex, block.id);
    });
  });
}

export function normalisePositions() {
  normalise();
}

export default {
  sections, usedKeys, seed, addSection, updateSection, deleteSection,
  addBlock, updateBlock, deleteBlock, moveBlock, moveSection,
  moveBlockTo, moveSectionTo, normalisePositions,
};
