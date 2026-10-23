/**
 * Put one partner logo back from a picture kept elsewhere.
 *
 * Used when a logo file went missing: the picture is copied into the
 * uploads, trimmed and measured like any new upload.
 *
 *   node scripts/restore-partner-logo.mjs <partner id> <source picture>
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { prepareLogo } from '../src/lib/logos.js';
import config from '../src/config.js';

const [id, source] = process.argv.slice(2);
if (!id || !source) {
  console.error('usage: node scripts/restore-partner-logo.mjs <id> <picture>');
  process.exit(1);
}

const db = new DatabaseSync(config.dbPath);
const partner = db.prepare('SELECT * FROM partners WHERE id = ?').get(Number(id));
if (!partner) {
  console.error(`no partner with id ${id}`);
  process.exit(1);
}
if (!fs.existsSync(source)) {
  console.error(`picture not found: ${source}`);
  process.exit(1);
}

// Copy into the uploads first: the pipeline works on files there.
const tmp = path.join(config.uploadDir, `restore-${Date.now().toString(36)}.png`);
await fs.promises.copyFile(source, tmp);

const logo = await prepareLogo(tmp);
db.prepare(
  'UPDATE partners SET logo_path = ?, logo_w = ?, logo_h = ?, logo_plate = ? WHERE id = ?',
).run(logo.file, logo.width, logo.height, logo.plate, partner.id);
db.close();

const kind = ['transparent', 'on white', 'on black'][logo.plate] ?? 'unknown';
console.log(`${partner.name}: ${logo.width}x${logo.height} (${kind}) -> ${logo.file}`);
console.log(fs.existsSync(path.join(config.uploadDir, logo.file)) ? 'file is on disk' : 'MISSING');
