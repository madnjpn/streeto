/**
 * Delete the files nothing points at any more.
 *
 * When a post, a listing or an account is removed, its picture usually
 * goes with it - but not always. Whatever is left over sits in the
 * upload folder for ever and eats space. This walks the database, works
 * out which files are still in use and removes the rest.
 *
 *   node scripts/prune-orphan-uploads.mjs --dry     (show what would go)
 *   node scripts/prune-orphan-uploads.mjs           (remove it)
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import config from '../src/config.js';

const dry = process.argv.includes('--dry');
const db = new DatabaseSync(config.dbPath);
// The live server may be writing at the same time.
db.exec('PRAGMA busy_timeout = 5000');

/* Every table that stores the path of an upload. */
const REFERENCES = [
  ['users', 'avatar'],
  ['groups', 'avatar'],
  ['posts', 'media_path'],
  ['messages', 'media_path'],
  ['messages', 'share_image'],
  ['builds', 'cover'],
  ['build_media', 'media_path'],
  ['parts', 'cover'],
  ['part_photos', 'media_path'],
  ['services', 'cover'],
  ['partners', 'logo_path'],
  ['vehicles', 'photo'],
  ['custom_fonts', 'filename'],
];

const used = new Set();
for (const [table, column] of REFERENCES) {
  for (const row of db.prepare(`SELECT ${column} AS file FROM ${table} WHERE ${column} IS NOT NULL AND ${column} <> ''`).all()) {
    used.add(String(row.file).split('/').pop());
  }
}
db.close();

/** Every file under a folder, with its full path. */
function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const base = path.resolve(config.uploadDir);
let count = 0;
let bytes = 0;
const removed = [];

for (const full of walk(base)) {
  const name = path.basename(full);
  if (used.has(name)) continue;
  const size = fs.statSync(full).size;
  bytes += size;
  count += 1;
  removed.push(path.relative(base, full).split(path.sep).join('/'));
  if (!dry) fs.rmSync(full, { force: true });
}

console.log(`${dry ? 'would delete' : 'deleted'}: ${count} file(s), ${(bytes / 1024 / 1024).toFixed(1)} MB`);
if (dry) for (const name of removed.slice(0, 20)) console.log(`   ${name}`);
if (removed.length > 20) console.log(`   ... and ${removed.length - 20} more`);
