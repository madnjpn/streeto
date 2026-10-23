/**
 * Give every uploaded file a home.
 *
 * The upload folder used to be one flat pile. This walks the database,
 * works out who owns each file and moves it into the right folder:
 *
 *   users/<id>/...      everything that driver uploaded
 *   site/partners/...   the logos on the partners page
 *   site/fonts/...      the fonts an admin installed
 *   site/misc/...       files nothing points at any more
 *
 * The rows are updated with the new path, so the site keeps working.
 *
 *   node scripts/reorganise-uploads.mjs --dry     (show the plan)
 *   node scripts/reorganise-uploads.mjs           (do it)
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import config from '../src/config.js';
import { userFolder, SITE_FOLDERS, ensureFolder } from '../src/lib/upload-paths.js';

const dry = process.argv.includes('--dry');
const db = new DatabaseSync(config.dbPath);
// The live server may be writing at the same time.
db.exec('PRAGMA busy_timeout = 5000');

/* table, column, the column that says who owns the file */
const OWNED = [
  ['users', 'avatar', 'id'],
  ['groups', 'avatar', 'owner_id'],
  ['posts', 'media_path', 'user_id'],
  ['messages', 'media_path', 'sender_id'],
  ['messages', 'share_image', 'sender_id'],
  ['builds', 'cover', 'user_id'],
  ['build_media', 'media_path', 'user_id'],
  ['parts', 'cover', 'user_id'],
  ['part_photos', 'media_path', 'user_id'],
  ['services', 'cover', 'user_id'],
  ['vehicles', 'photo', 'user_id'],
];

/* table, column, the folder the site keeps the file in */
const SITE_OWNED = [
  ['custom_fonts', 'filename', SITE_FOLDERS.fonts],
  ['partners', 'logo_path', SITE_FOLDERS.partners],
];

const base = path.resolve(config.uploadDir);
const inside = (rel) => {
  const target = path.resolve(base, rel);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
};

/* file name -> the folder it belongs in */
const target = new Map();
const rows = [];

for (const [table, column, ownerColumn] of OWNED) {
  const list = db.prepare(`SELECT id, ${column} AS file, ${ownerColumn} AS owner FROM ${table} WHERE ${column} IS NOT NULL AND ${column} <> ''`).all();
  for (const row of list) {
    const name = String(row.file);
    if (name.includes('/')) continue; // already in a folder
    const folder = userFolder(row.owner);
    // One file can be shared (a listing borrows the photo of a build),
    // so it lives in one folder - the first owner that claimed it.
    if (!target.has(name)) target.set(name, folder);
    rows.push({ table, column, id: row.id, name, folder: target.get(name) });
  }
}

for (const [table, column, folder] of SITE_OWNED) {
  const list = db.prepare(`SELECT id, ${column} AS file FROM ${table} WHERE ${column} IS NOT NULL AND ${column} <> ''`).all();
  for (const row of list) {
    const name = String(row.file);
    if (name.includes('/')) continue;
    if (!target.has(name)) target.set(name, folder);
    rows.push({ table, column, id: row.id, name, folder: target.get(name) });
  }
}

/* Every driver gets a folder of their own, even an empty one. */
const users = db.prepare('SELECT id FROM users ORDER BY id').all();
for (const user of users) ensureFolder(userFolder(user.id));

/* Move the files. */
let moved = 0;
let missing = 0;
const seen = new Set();
for (const [name, folder] of target) {
  if (seen.has(name)) continue;
  seen.add(name);
  const from = inside(name);
  const to = inside(`${folder}/${name}`);
  if (!from || !to) continue;
  if (!fs.existsSync(from)) {
    missing += 1;
    continue;
  }
  if (fs.existsSync(to)) continue; // already there
  if (!dry) {
    ensureFolder(folder);
    fs.renameSync(from, to);
  }
  moved += 1;
}

/* Files nothing points at any more still belong to the site. */
const referenced = new Set([...target.keys()]);
const orphans = [];
for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  if (referenced.has(entry.name)) continue;
  orphans.push(entry.name);
}
for (const name of orphans) {
  const from = inside(name);
  const to = inside(`${SITE_FOLDERS.misc}/${name}`);
  if (!from || !to || !fs.existsSync(from)) continue;
  if (!dry) {
    ensureFolder(SITE_FOLDERS.misc);
    fs.renameSync(from, to);
  }
}

/* Point the rows at the new paths. */
let updated = 0;
for (const row of rows) {
  const newPath = `${row.folder}/${row.name}`;
  if (!dry) {
    db.prepare(`UPDATE ${row.table} SET ${row.column} = ? WHERE id = ?`).run(newPath, row.id);
  }
  updated += 1;
}

db.close();

console.log(`${dry ? 'would move' : 'moved'}: ${moved} file(s)`);
console.log(`updated rows: ${updated}`);
console.log(`files that were already gone: ${missing}`);
console.log(`files nothing points at (${SITE_FOLDERS.misc}): ${orphans.length}`);
console.log(`driver folders: ${users.length}`);
