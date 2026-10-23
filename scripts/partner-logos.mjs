/**
 * Re-prepare every partner logo.
 *
 * Logos uploaded before the trimming existed are still padded with empty
 * space, so they look small on the partners wall. This walks the table,
 * trims each picture, measures it and writes the new size back.
 *
 *   node scripts/partner-logos.mjs
 */
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { prepareLogo } from '../src/lib/logos.js';
import config from '../src/config.js';

const db = new DatabaseSync(config.dbPath);
const rows = db.prepare('SELECT id, name, logo_path FROM partners ORDER BY id').all();

let changed = 0;
for (const row of rows) {
  const src = path.join(config.uploadDir, row.logo_path);
  if (!fs.existsSync(src)) {
    console.log(`#${row.id} ${row.name}: file missing (${row.logo_path}) - skipped`);
    continue;
  }
  try {
    const logo = await prepareLogo(src);
    db.prepare(
      'UPDATE partners SET logo_path = ?, logo_w = ?, logo_h = ?, logo_plate = ? WHERE id = ?',
    ).run(logo.file, logo.width, logo.height, logo.plate, row.id);
    changed += 1;
    const kind = ['transparent', 'on white', 'on black'][logo.plate] ?? 'unknown';
    console.log(
      `#${row.id} ${row.name}: ${logo.width}x${logo.height} (${kind}) -> ${logo.file}`,
    );
  } catch (error) {
    console.log(`#${row.id} ${row.name}: failed - ${error.message}`);
  }
}

db.close();
console.log(`\n${changed} logo(s) prepared.`);
