/**
 * Repair the rows that point at a file that is not there.
 *
 * A file can be shared between two rows (a listing borrows the photo of
 * a build, a message shares a picture). When the upload folder was
 * reorganised, the file moved once - so every row that points at it
 * has to point at the place it actually ended up.
 *
 *   node scripts/repair-upload-paths.mjs --dry
 *   node scripts/repair-upload-paths.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import config from '../src/config.js';

const dry = process.argv.includes('--dry');
const db = new DatabaseSync(config.dbPath);
// The live server may be writing at the same time.
db.exec('PRAGMA busy_timeout = 5000');

const REFS = [
  ['users', 'avatar', 'id'],
  ['groups', 'avatar', 'id'],
  ['posts', 'media_path', 'id'],
  ['messages', 'media_path', 'id'],
  ['messages', 'share_image', 'id'],
  ['builds', 'cover', 'id'],
  ['build_media', 'media_path', 'id'],
  ['parts', 'cover', 'id'],
  ['part_photos', 'media_path', 'id'],
  ['services', 'cover', 'id'],
  ['partners', 'logo_path', 'id'],
  ['vehicles', 'photo', 'id'],
  ['custom_fonts', 'filename', 'id'],
];

/** Every file on disk, by its name. */
const byName = new Map();
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() && !byName.has(entry.name)) {
      byName.set(entry.name, path.relative(config.uploadDir, full).split(path.sep).join('/'));
    }
  }
};
walk(config.uploadDir);

let fixed = 0;
let lost = 0;
for (const [table, column] of REFS) {
  const rows = db.prepare(`SELECT id, ${column} AS file FROM ${table} WHERE ${column} IS NOT NULL AND ${column} <> ''`).all();
  for (const row of rows) {
    const stored = String(row.file);
    if (fs.existsSync(path.join(config.uploadDir, stored))) continue;
    const name = path.basename(stored);
    const actual = byName.get(name);
    if (!actual) {
      lost += 1;
      console.log(`lost     ${table}.${column} #${row.id}: ${stored}`);
      continue;
    }
    console.log(`repairs  ${table}.${column} #${row.id}: ${stored} -> ${actual}`);
    if (!dry) db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).run(actual, row.id);
    fixed += 1;
  }
}

db.close();
console.log(`\n${dry ? 'would fix' : 'fixed'}: ${fixed} row(s) | files that are gone for good: ${lost}`);
