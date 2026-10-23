import { all, count, get, run } from '../db.js';
import { removeUpload } from '../lib/uploads.js';
import config from '../config.js';

/**
 * Parts marketplace - the buy & sell half of the Services tab.
 *
 * A listing carries a title, a category, an optional price (with a note
 * for "negotiable" / "swap"), a description, a contact phone number, a
 * rough location and up to six photos. Sellers can mark a listing as
 * sold so it stays visible but stops looking live.
 */

/** Part categories. Keys are stored; values are the English labels
 *  the i18n layer translates. */
export const CATEGORIES = {
  engine: 'Engine',
  drivetrain: 'Drivetrain',
  exhausts: 'Exhausts',
  tuning: 'Tuning',
  exterior: 'Exterior',
  interior: 'Interior',
  wheels: 'Wheels & tires',
  suspension: 'Suspension',
  brakes: 'Brakes',
  electrical: 'Electrical',
  other: 'Other',
};

export const CATEGORY_KEYS = Object.keys(CATEGORIES);
export const isCategory = (value) => Object.prototype.hasOwnProperty.call(CATEGORIES, value);

/** Every listing query needs the seller, so it is baked in here. */
const SELECT = `
  SELECT p.*,
         u.username, u.display_name, u.avatar,
         (SELECT COUNT(*) FROM part_photos pp WHERE pp.part_id = p.id) AS photo_count
    FROM parts p
    JOIN users u ON u.id = p.user_id
`;

function scopeWhere(scope, { viewerId, userId }) {
  switch (scope) {
    case 'mine':
      return { where: 'p.user_id = :viewer', params: { viewer: viewerId } };
    case 'user':
      return { where: 'p.user_id = :user', params: { user: userId || viewerId } };
    default:
      return { where: '1 = 1', params: {} };
  }
}

const likeParam = (term) => `%${String(term).trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;

export function feed({
  scope = 'all', viewerId = 0, userId = 0, category = '', q = '',
  sort = 'new', limit = 18, offset = 0,
} = {}) {
  const { where, params } = scopeWhere(scope, { viewerId, userId });
  const clauses = [where];
  const p = { ...params, limit, offset };

  if (isCategory(category)) {
    clauses.push('p.category = :category');
    p.category = category;
  }
  const term = String(q ?? '').trim();
  if (term) {
    clauses.push(`(p.title LIKE :like ESCAPE '\\' OR p.description LIKE :like ESCAPE '\\'
                   OR p.location LIKE :like ESCAPE '\\')`);
    p.like = likeParam(term);
  }

  // Price sorts compare listings in the same currency, so a USD price
  // is converted to lari first (the reference rate is bound as :rate).
  const priceInGel = "(CASE WHEN p.currency = 'USD' THEN p.price * :rate ELSE p.price END)";
  const byPrice = sort === 'price_low' || sort === 'price_high';
  const order =
    sort === 'price_low' ? `p.price IS NULL, ${priceInGel} ASC, p.created_at DESC`
      : sort === 'price_high' ? `p.price IS NULL, ${priceInGel} DESC, p.created_at DESC`
        : 'p.created_at DESC, p.id DESC';

  return all(
    `${SELECT} WHERE ${clauses.join(' AND ')} ORDER BY ${order} LIMIT :limit OFFSET :offset`,
    byPrice ? { ...p, rate: config.usdToGel } : p,
  );
}

export function countFor({ scope = 'all', viewerId = 0, userId = 0, category = '', q = '' } = {}) {
  const { where, params } = scopeWhere(scope, { viewerId, userId });
  const clauses = [where];
  const p = { ...params };
  if (isCategory(category)) {
    clauses.push('p.category = :category');
    p.category = category;
  }
  const term = String(q ?? '').trim();
  if (term) {
    clauses.push(`(p.title LIKE :like ESCAPE '\\' OR p.description LIKE :like ESCAPE '\\'
                   OR p.location LIKE :like ESCAPE '\\')`);
    p.like = likeParam(term);
  }
  return get(`SELECT COUNT(*) AS n FROM parts p WHERE ${clauses.join(' AND ')}`, p)?.n ?? 0;
}

export const byId = (id) => get(`${SELECT} WHERE p.id = :id`, { id });

export const photos = (partId) =>
  all('SELECT * FROM part_photos WHERE part_id = ? ORDER BY position ASC, id ASC', partId);

export const photoById = (id) => get('SELECT * FROM part_photos WHERE id = ?', id);

export function createPart(data) {
  const info = run(
    `INSERT INTO parts
       (user_id, title, category, price, currency, price_note, description, phone, location, status, cover)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    data.userId,
    data.title,
    data.category,
    data.price,
    data.currency ?? 'GEL',
    data.priceNote,
    data.description,
    data.phone,
    data.location,
    data.status ?? 'available',
    data.cover ?? null,
  );
  return info.lastInsertRowid;
}

export function updatePart(id, data) {
  run(
    `UPDATE parts
        SET title = ?, category = ?, price = ?, currency = ?, price_note = ?, description = ?,
            phone = ?, location = ?, status = ?, cover = COALESCE(?, cover),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`,
    data.title,
    data.category,
    data.price,
    data.currency ?? 'GEL',
    data.priceNote,
    data.description,
    data.phone,
    data.location,
    data.status ?? 'available',
    data.cover ?? null,
    id,
  );
}

export const setStatus = (id, status) =>
  run(
    `UPDATE parts SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    status === 'sold' ? 'sold' : 'available',
    id,
  );

/** Delete a listing and every file it owns. Owner or a site admin. */
export function removePart(id, viewerId, { asModerator = false } = {}) {
  const part = get('SELECT id, user_id FROM parts WHERE id = ?', id);
  if (!part || (part.user_id !== viewerId && !asModerator)) return false;
  const files = all('SELECT media_path FROM part_photos WHERE part_id = ?', id).map((r) => r.media_path);
  run('DELETE FROM parts WHERE id = ?', id);
  files.forEach((file) => removeUpload(file));
  return true;
}

export function addPhoto({ partId, userId, mediaPath, position = 0 }) {
  run(
    'INSERT INTO part_photos (part_id, user_id, media_path, position) VALUES (?, ?, ?, ?)',
    partId,
    userId,
    mediaPath,
    position,
  );
  return photos(partId);
}

export function removePhoto(photoId, viewerId, { asModerator = false } = {}) {
  const item = get('SELECT id, part_id, user_id, media_path FROM part_photos WHERE id = ?', photoId);
  if (!item || (item.user_id !== viewerId && !asModerator)) return false;
  run('DELETE FROM part_photos WHERE id = ?', photoId);
  removeUpload(item.media_path);

  // If the deleted shot was the cover, promote the next one.
  const part = get('SELECT cover FROM parts WHERE id = ?', item.part_id);
  if (part && part.cover === item.media_path) {
    const next = get(
      'SELECT media_path FROM part_photos WHERE part_id = ? ORDER BY position ASC, id ASC LIMIT 1',
      item.part_id,
    );
    run('UPDATE parts SET cover = ? WHERE id = ?', next?.media_path ?? null, item.part_id);
  }
  return true;
}

export const countByUser = (userId) => count('parts', 'user_id = ?', userId);

/** How many live listings sit in each category, for the filter chips. */
export const countsByCategory = () =>
  all(`SELECT category, COUNT(*) AS n FROM parts WHERE status = 'available' GROUP BY category`);

export const recent = (limit = 6) => all(`${SELECT} ORDER BY p.created_at DESC LIMIT ?`, limit);

export default {
  CATEGORIES, CATEGORY_KEYS, isCategory, feed, countFor, byId, photos, photoById,
  createPart, updatePart, setStatus, removePart, addPhoto, removePhoto, countByUser,
  countsByCategory, recent,
};
