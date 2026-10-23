import { all, count, get, run } from '../db.js';
import { removeUpload } from '../lib/uploads.js';

/**
 * Maintenance directory - the "find a workshop" half of the Services
 * tab. Shops and specialists post a listing with a category, a short
 * description, contact details and a map pin. Other drivers leave a
 * star rating and a written review.
 *
 * Reviews are one-per-driver-per-listing (a UNIQUE key in the schema),
 * so re-posting edits your own review instead of stacking up.
 */

/** Service categories. Keys are stored; values are the English
 *  labels the i18n layer translates. */
export const CATEGORIES = {
  body_repairs: 'Body repairs',
  body_paint: 'Body paint',
  electronics: 'Electronics',
  drivetrain_mech: 'Drivetrain mechanic',
  engine_mech: 'Engine mechanic',
  ecu_tuning: 'ECU tuning',
  dyno: 'Dyno',
  detailing: 'Detailing',
  tires: 'Tires & wheels',
  other: 'Other',
};

export const CATEGORY_KEYS = Object.keys(CATEGORIES);
export const isCategory = (value) => Object.prototype.hasOwnProperty.call(CATEGORIES, value);

/* ── claims ─────────────────────────────────────────────────────── */

/** Check if a user has a pending claim on a service. */
export const hasPendingClaim = (serviceId, userId) =>
  Boolean(get(
    `SELECT 1 AS x FROM service_claims
      WHERE service_id = ? AND claimant_id = ? AND status = 'pending'`,
    serviceId, userId,
  ));

/** Get a user's claim on a service (any status). */
export const getClaim = (serviceId, userId) =>
  get(
    `SELECT * FROM service_claims WHERE service_id = ? AND claimant_id = ?`,
    serviceId, userId,
  );

/** Get a claim by its ID. */
export const getClaimById = (claimId) =>
  get('SELECT * FROM service_claims WHERE id = ?', claimId);

/** Get all pending claims (for admin). */
export const pendingClaims = () =>
  all(
    `SELECT c.*, s.title AS service_title, s.user_id AS current_owner_id,
            u.username AS claimant_username, u.display_name AS claimant_display_name,
            u.provider_name AS claimant_provider_name, u.is_provider AS claimant_is_provider,
            o.username AS owner_username
       FROM service_claims c
       JOIN services s ON s.id = c.service_id
       JOIN users u ON u.id = c.claimant_id
       JOIN users o ON o.id = s.user_id
      WHERE c.status = 'pending'
      ORDER BY c.created_at DESC`,
  );

/** Create a claim (fails if already exists). */
export function createClaim(serviceId, claimantId, message = null) {
  const info = run(
    `INSERT INTO service_claims (service_id, claimant_id, message) VALUES (?, ?, ?)`,
    serviceId, claimantId, message,
  );
  return info.lastInsertRowid;
}

/**
 * The business name of a member always follows the listings they own - it is
 * never typed in by hand. A member with no listings keeps the generic
 * "Provides Service" badge.
 */
export function setProviderNameFromListings(userId) {
  const titles = all(
    'SELECT title FROM services WHERE user_id = ? ORDER BY created_at ASC',
    userId,
  )
    .map((row) => (row.title || '').trim())
    .filter(Boolean);
  const name = titles.length ? titles.join(', ') : 'Provides Service';
  run('UPDATE users SET is_provider = 1, provider_name = ? WHERE id = ?', name, userId);
  return name;
}

/**
 * Approve a claim.
 *
 * A listing has exactly one owner. On approval the ownership moves to the
 * claimant, the listing becomes verified, and the business names follow the
 * listings: the new owner gets the service name, and the old owner keeps
 * only the listings that are still theirs (or the generic badge when they
 * have none left).
 */
export function approveClaim(claimId, adminId) {
  const claim = get('SELECT * FROM service_claims WHERE id = ?', claimId);
  if (!claim || claim.status !== 'pending') return null;
  const service = get('SELECT * FROM services WHERE id = ?', claim.service_id);
  if (!service) return null;

  const oldOwnerId = service.user_id;
  const newOwnerId = claim.claimant_id;

  // Transfer ownership and verify the listing.
  run(`UPDATE services SET user_id = ?, verified = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    newOwnerId, claim.service_id);
  // Mark claim approved
  run(`UPDATE service_claims SET status = 'approved', reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), reviewed_by = ? WHERE id = ?`,
    adminId, claimId);
  // Reject any other pending claims on the same service
  run(`UPDATE service_claims SET status = 'rejected', reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), reviewed_by = ? WHERE service_id = ? AND id != ? AND status = 'pending'`,
    adminId, claim.service_id, claimId);

  // The new owner takes the business name of the listing they verified.
  setProviderNameFromListings(newOwnerId);

  // The old owner loses the badge of the listing that moved. Until this
  // moment they kept it - the claim was still being reviewed.
  if (oldOwnerId !== newOwnerId) {
    setProviderNameFromListings(oldOwnerId);
  }

  return claim;
}

/** Reject a claim. */
export function rejectClaim(claimId, adminId) {
  return run(
    `UPDATE service_claims SET status = 'rejected', reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), reviewed_by = ? WHERE id = ? AND status = 'pending'`,
    adminId, claimId,
  );
}

/* ── listings ───────────────────────────────────────────────────── */

/** Listings always carry the provider and their live rating. */
const SELECT = `
  SELECT s.*,
         u.username, u.display_name, u.avatar, u.is_provider, u.provider_name,
         (SELECT COUNT(*) FROM service_reviews r WHERE r.service_id = s.id) AS review_count,
         (SELECT ROUND(AVG(rating), 2) FROM service_reviews r WHERE r.service_id = s.id) AS rating_avg
    FROM services s
    JOIN users u ON u.id = s.user_id
`;

function scopeWhere(scope, { viewerId, userId }) {
  switch (scope) {
    case 'mine':
      return { where: 's.user_id = :viewer', params: { viewer: viewerId } };
    case 'user':
      return { where: 's.user_id = :user', params: { user: userId || viewerId } };
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
    clauses.push('s.category = :category');
    p.category = category;
  }
  const term = String(q ?? '').trim();
  if (term) {
    clauses.push(`(s.title LIKE :like ESCAPE '\\' OR s.description LIKE :like ESCAPE '\\'
                   OR s.place_name LIKE :like ESCAPE '\\' OR s.address LIKE :like ESCAPE '\\')`);
    p.like = likeParam(term);
  }

  const order =
    sort === 'rating' ? 'rating_avg IS NULL, rating_avg DESC, review_count DESC, s.created_at DESC'
      : 's.created_at DESC, s.id DESC';

  return all(
    `${SELECT} WHERE ${clauses.join(' AND ')} ORDER BY ${order} LIMIT :limit OFFSET :offset`,
    p,
  );
}

export function countFor({ scope = 'all', viewerId = 0, userId = 0, category = '', q = '' } = {}) {
  const { where, params } = scopeWhere(scope, { viewerId, userId });
  const clauses = [where];
  const p = { ...params };
  if (isCategory(category)) {
    clauses.push('s.category = :category');
    p.category = category;
  }
  const term = String(q ?? '').trim();
  if (term) {
    clauses.push(`(s.title LIKE :like ESCAPE '\\' OR s.description LIKE :like ESCAPE '\\'
                   OR s.place_name LIKE :like ESCAPE '\\' OR s.address LIKE :like ESCAPE '\\')`);
    p.like = likeParam(term);
  }
  return get(`SELECT COUNT(*) AS n FROM services s WHERE ${clauses.join(' AND ')}`, p)?.n ?? 0;
}

export const byId = (id) => get(`${SELECT} WHERE s.id = :id`, { id });

export function createService(data) {
  const info = run(
    `INSERT INTO services
       (user_id, title, category, description, phone, email, place_name, address, lat, lng, zoom, cover, verified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    data.userId,
    data.title,
    data.category,
    data.description,
    data.phone,
    data.email,
    data.placeName,
    data.address,
    data.lat,
    data.lng,
    data.zoom ?? null,
    data.cover ?? null,
    data.verified ? 1 : 0,
  );
  return info.lastInsertRowid;
}

export function updateService(id, data) {
  run(
    `UPDATE services
        SET title = ?, category = ?, description = ?, phone = ?, email = ?,
            place_name = ?, address = ?, lat = ?, lng = ?, zoom = COALESCE(?, zoom),
            cover = COALESCE(?, cover),
            verified = COALESCE(?, verified),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`,
    data.title,
    data.category,
    data.description,
    data.phone,
    data.email,
    data.placeName,
    data.address,
    data.lat,
    data.lng,
    data.zoom ?? null,
    data.cover ?? null,
    data.verified !== undefined ? (data.verified ? 1 : 0) : null,
    id,
  );
}

/** Delete a listing, its reviews and its cover file. Owner or an admin. */
export function removeService(id, viewerId, { asModerator = false } = {}) {
  const service = get('SELECT id, user_id, title, cover, verified FROM services WHERE id = ?', id);
  if (!service || (service.user_id !== viewerId && !asModerator)) return false;
  const ownerId = service.user_id;
  const serviceTitle = (service.title || '').trim();
  const wasVerified = service.verified === 1;

  run('DELETE FROM services WHERE id = ?', id);
  removeUpload(service.cover);

  // If the service was verified, remove its name from the owner's provider_name
  if (wasVerified) {
    const owner = get('SELECT is_provider, provider_name FROM users WHERE id = ?', ownerId);
    if (owner && owner.provider_name) {
      const oldName = (owner.provider_name || '').trim();
      const parts = oldName.split(',').map((s) => s.trim()).filter(Boolean).filter((p) => p !== 'Provides Service');
      const filtered = parts.filter((p) => p !== serviceTitle);
      const otherServices = get('SELECT COUNT(*) AS n FROM services WHERE user_id = ? AND verified = 1', ownerId);
      if (otherServices && otherServices.n > 0) {
        // Keep provider flag, update name
        const newProviderName = filtered.join(', ') || 'Provides Service';
        run('UPDATE users SET provider_name = ? WHERE id = ?', newProviderName, ownerId);
      } else {
        // No other verified services - keep provider flag, set to "Provides Service"
        run('UPDATE users SET is_provider = 1, provider_name = ? WHERE id = ?', 'Provides Service', ownerId);
      }
    }
  }

  return true;
}

/* ── reviews ───────────────────────────────────────────────────── */

export const reviews = (serviceId) =>
  all(
    `SELECT r.*, u.username, u.display_name, u.avatar
       FROM service_reviews r
       JOIN users u ON u.id = r.user_id
      WHERE r.service_id = ?
      ORDER BY r.updated_at DESC, r.id DESC`,
    serviceId,
  );

export const myReview = (serviceId, userId) =>
  get('SELECT * FROM service_reviews WHERE service_id = ? AND user_id = ?', serviceId, userId) ?? null;

/** Add or update this driver's review (one per listing). */
export function saveReview({ serviceId, userId, rating, body }) {
  const value = Math.min(5, Math.max(1, Number.parseInt(rating, 10) || 5));
  run(
    `INSERT INTO service_reviews (service_id, user_id, rating, body)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (service_id, user_id) DO UPDATE
       SET rating = excluded.rating, body = excluded.body,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    serviceId,
    userId,
    value,
    body || null,
  );
  return get(
    `SELECT COUNT(*) AS n, ROUND(AVG(rating), 2) AS avg FROM service_reviews WHERE service_id = ?`,
    serviceId,
  );
}

export function removeReview(serviceId, userId) {
  run('DELETE FROM service_reviews WHERE service_id = ? AND user_id = ?', serviceId, userId);
}

export const countByUser = (userId) => count('services', 'user_id = ?', userId);


/** How many listings sit in each category, for the filter chips. */
export const countsByCategory = () =>
  all('SELECT category, COUNT(*) AS n FROM services GROUP BY category');

/** Best-rated listings first, for the hub page. */
export const topRated = (limit = 4) =>
  all(`${SELECT} WHERE (SELECT COUNT(*) FROM service_reviews r WHERE r.service_id = s.id) > 0
       ORDER BY rating_avg DESC, review_count DESC LIMIT ?`, limit);

export const recent = (limit = 6) => all(`${SELECT} ORDER BY s.created_at DESC LIMIT ?`, limit);

export default {
  CATEGORIES, CATEGORY_KEYS, isCategory, feed, countFor, byId, createService, updateService,
  removeService, reviews, myReview, saveReview, removeReview, countByUser, countsByCategory,
  topRated, recent, hasPendingClaim, getClaim, getClaimById, pendingClaims,
  createClaim, approveClaim, rejectClaim,
};
