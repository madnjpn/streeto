/**
 * The build timeline.
 *
 * A build carries a short summary of its mods. The timeline is the
 * history behind that summary: every change with the day it happened,
 * how far the car had come, what it cost and a picture of the result.
 * It is what makes a build worth following.
 */
import { all, get, run } from '../db.js';
import { removeUpload } from '../lib/uploads.js';

/** The kinds of work a build goes through. */
export const KINDS = {
  engine: 'Engine',
  suspension: 'Suspension',
  brakes: 'Brakes',
  body: 'Body & paint',
  interior: 'Interior',
  electronics: 'Electronics',
  exhaust: 'Exhaust',
  wheels: 'Wheels & tyres',
  other: 'Other',
};

export const KIND_KEYS = Object.keys(KINDS);
export const isKind = (value) => Object.prototype.hasOwnProperty.call(KINDS, value);

/** The timeline of a build, newest first. */
export const list = (buildId) => all(
  'SELECT * FROM build_timeline WHERE build_id = ? ORDER BY changed_at DESC, id DESC',
  buildId,
);

export const byId = (id) => get('SELECT * FROM build_timeline WHERE id = ?', id);

/** How much a build has been worked on - shown on the build page. */
export const summary = (buildId) => get(
  `SELECT COUNT(*) AS entries,
          SUM(cost) AS spent,
          MIN(changed_at) AS first_change,
          MAX(changed_at) AS last_change
     FROM build_timeline WHERE build_id = ?`,
  buildId,
);

/** Add an entry. */
export function add({ buildId, userId, title, kind, description, mileage, cost, photo, changedAt }) {
  const info = run(
    `INSERT INTO build_timeline
       (build_id, user_id, title, kind, description, mileage, cost, photo, changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
    buildId,
    userId,
    title,
    isKind(kind) ? kind : 'other',
    description || null,
    mileage ?? null,
    cost ?? null,
    photo || null,
    changedAt || null,
  );
  return info.lastInsertRowid;
}

/** Change an entry. */
export function update(id, { title, kind, description, mileage, cost, photo, changedAt }) {
  const sets = [];
  const params = [];
  if (title !== undefined) { sets.push('title = ?'); params.push(title); }
  if (kind !== undefined) { sets.push('kind = ?'); params.push(isKind(kind) ? kind : 'other'); }
  if (description !== undefined) { sets.push('description = ?'); params.push(description || null); }
  if (mileage !== undefined) { sets.push('mileage = ?'); params.push(mileage ?? null); }
  if (cost !== undefined) { sets.push('cost = ?'); params.push(cost ?? null); }
  if (photo !== undefined) { sets.push('photo = ?'); params.push(photo || null); }
  if (changedAt !== undefined) { sets.push('changed_at = ?'); params.push(changedAt); }
  if (!sets.length) return false;
  params.push(id);
  run(`UPDATE build_timeline SET ${sets.join(', ')} WHERE id = ?`, ...params);
  return true;
}

/** Take an entry out, and its picture with it. */
export function remove(id) {
  const row = byId(id);
  if (!row) return false;
  run('DELETE FROM build_timeline WHERE id = ?', id);
  if (row.photo) removeUpload(row.photo);
  return true;
}

export default { KINDS, KIND_KEYS, isKind, list, byId, summary, add, update, remove };
