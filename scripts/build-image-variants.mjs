/**
 * Give the pictures that are already on the server their smaller copies.
 *
 * New uploads get them as they arrive. The pictures that were uploaded
 * before this existed only have the big one - this writes the small
 * copies for those, so a phone does not have to download the big file
 * either.
 *
 *   node scripts/build-image-variants.mjs --dry
 *   node scripts/build-image-variants.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
import config from '../src/config.js';
import { VARIANT_WIDTHS } from '../src/lib/images.js';
import { resolveUploadPath, relativeUploadPath } from '../src/lib/upload-paths.js';

const dry = process.argv.includes('--dry');
const db = new DatabaseSync(config.dbPath);
// The live server may be writing at the same time.
db.exec('PRAGMA busy_timeout = 5000');

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
  ['vehicles', 'photo'],
];

/* Every picture the site points at, once. */
const pictures = new Set();
for (const [table, column] of REFERENCES) {
  for (const row of db.prepare(`SELECT ${column} AS file FROM ${table} WHERE ${column} IS NOT NULL AND ${column} <> ''`).all()) {
    pictures.add(String(row.file));
  }
}

let made = 0;
let skipped = 0;
let failed = 0;

for (const stored of pictures) {
  const full = resolveUploadPath(stored);
  if (!full || !fs.existsSync(full)) continue;
  if (!/\.(png|jpe?g|webp)$/i.test(stored)) continue;

  try {
    const meta = await sharp(full).metadata();
    const width = meta.width || 0;
    const small = VARIANT_WIDTHS.filter((w) => w < width);
    if (!small.length) {
      skipped += 1;
      continue;
    }
    const source = await sharp(full).rotate().toBuffer();
    const rows = [];
    for (const w of small) {
      const variantPath = full.replace(/\.[^.]+$/, `-${w}.webp`);
      if (!dry) {
        const data = await sharp(source)
          .resize({ width: w, withoutEnlargement: true })
          .webp({ quality: 74 })
          .toBuffer();
        await fs.promises.writeFile(variantPath, data);
      }
      rows.push({ width: w, path: relativeUploadPath(variantPath) });
    }
    if (!dry) {
      db.prepare('DELETE FROM upload_variants WHERE source = ?').run(stored);
      for (const row of rows) {
        db.prepare('INSERT OR REPLACE INTO upload_variants (source, width, path) VALUES (?, ?, ?)').run(stored, row.width, row.path);
      }
      db.prepare('INSERT OR REPLACE INTO upload_variants (source, width, path) VALUES (?, ?, ?)').run(stored, width, stored);
    }
    made += 1;
    console.log(`${dry ? 'would copy' : 'copied'} ${stored} (${width}px) -> ${small.join(', ')}`);
  } catch (error) {
    failed += 1;
    console.log(`failed   ${stored}: ${error.message}`);
  }
}

db.close();
console.log(`\n${dry ? 'would give' : 'gave'} ${made} picture(s) their small copies | ${skipped} too small | ${failed} failed`);
