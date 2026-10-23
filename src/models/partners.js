import fs from 'node:fs';
import path from 'node:path';
import { all, get, run } from '../db.js';
import { removeUpload } from '../lib/uploads.js';
import config from '../config.js';

/**
 * The partners the wall shows.
 *
 * A partner whose logo file is gone is left out: a broken picture on
 * the wall is worse than one partner less.
 */
export const list = () => all(
  `SELECT * FROM partners WHERE is_active = 1 ORDER BY position, id`
).filter((p) => p.logo_path && fs.existsSync(path.join(config.uploadDir, p.logo_path)));

/** All partners for admin (includes inactive). */
export const listAll = () => all(
  `SELECT * FROM partners ORDER BY position, id`
);

export const byId = (id) => get('SELECT * FROM partners WHERE id = ?', id);

export const bySlug = (slug) => get('SELECT * FROM partners WHERE slug = ?', slug);

export function create({
  name,
  slug,
  logoPath,
  url = null,
  logoW = null,
  logoH = null,
  logoPlate = 0,
}) {
  const info = run(
    `INSERT INTO partners (name, slug, logo_path, url, logo_w, logo_h, logo_plate)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    name,
    slug,
    logoPath,
    url,
    logoW,
    logoH,
    logoPlate ? Number(logoPlate) : 0,
  );
  return info.lastInsertRowid;
}

export function update(id, data) {
  const sets = [];
  const params = [];
  if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name); }
  if (data.slug !== undefined) { sets.push('slug = ?'); params.push(data.slug); }
  if (data.logoPath !== undefined) { sets.push('logo_path = ?'); params.push(data.logoPath); }
  if (data.logoW !== undefined) { sets.push('logo_w = ?'); params.push(data.logoW); }
  if (data.logoH !== undefined) { sets.push('logo_h = ?'); params.push(data.logoH); }
  if (data.logoPlate !== undefined) { sets.push('logo_plate = ?'); params.push(Number(data.logoPlate) || 0); }
  if (data.url !== undefined) { sets.push('url = ?'); params.push(data.url); }
  if (data.position !== undefined) { sets.push('position = ?'); params.push(data.position); }
  if (data.isActive !== undefined) { sets.push('is_active = ?'); params.push(data.isActive ? 1 : 0); }
  if (!sets.length) return;
  sets.push('updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')');
  params.push(id);
  run(`UPDATE partners SET ${sets.join(', ')} WHERE id = ?`, ...params);
}

export function remove(id) {
  const p = byId(id);
  if (p && p.logo_path) removeUpload(p.logo_path);
  run('DELETE FROM partners WHERE id = ?', id);
}

/** Reorder partners by array of [id, position]. */
export function reorder(pairs) {
  for (const [id, position] of pairs) {
    run('UPDATE partners SET position = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\') WHERE id = ?', position, id);
  }
}

export default { list, listAll, byId, bySlug, create, update, remove, reorder };