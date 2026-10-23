import express from 'express';
import * as parts from '../models/parts.js';
import * as maintenance from '../models/maintenance.js';
import * as users from '../models/users.js';
import { requireAuth } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { get, run } from '../db.js';
import {
  partUpload, serviceUpload, optimizeAs, removeUpload, mediaKind,
} from '../lib/uploads.js';
import { cleanText, checkCoords, checkEmail, checkZoom } from '../lib/validate.js';
import { formatPhone, isValidPhone, PHONE_PLACEHOLDER } from '../lib/phone.js';
import { normalizeCurrency } from '../lib/currency.js';
import { wantsJson, jsonOk, jsonError, pagination, backTo } from '../lib/http.js';
import * as notifications from '../models/notifications.js';
import * as pushLib from '../lib/push.js';

const router = express.Router();

const PER_PAGE = 18;

const PART_SCOPES = { all: 'All parts', mine: 'My listings' };
const PART_SORTS = {
  new: 'Newest',
  price_low: 'Price: low to high',
  price_high: 'Price: high to low',
};
const SERVICE_SCOPES = { all: 'All services', mine: 'My listings' };
const SERVICE_SORTS = { new: 'Newest', rating: 'Top rated' };

/**
 * Let the admins know that a service claim is waiting for them - both
 * when a driver claims a listing and when a provider publishes their own
 * (which files a claim for them).
 */
function notifyAdminsAboutClaim({ serviceId, serviceTitle, actorId, actorUsername }) {
  notifications.notifyAdmins({
    actorId,
    type: 'service_claim',
    entityId: serviceId,
    url: '/admin/service-claims',
    text: 'claims ownership of {name}|' + serviceTitle,
  });
  for (const admin of users.adminIds()) {
    pushLib.sendToUser(admin, {
      title: 'New service claim',
      body: `${actorUsername} claims ${serviceTitle}`,
      url: '/admin/service-claims',
      tag: `service-claim-${serviceId}`,
    });
  }
}

/* ── form helpers ─────────────────────────────────────────────── */

/** Whole units of currency. Empty or junk -> null. */
const priceIn = (value) => {
  const raw = String(value ?? '').replace(/[^\d.]/g, '').trim();
  if (!raw) return null;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 0 || n > 100_000_000) return null;
  return n;
};

/**
 * The phone number.
 *
 * One format: the country code and nine digits. The field keeps the
 * shape while the number is typed, and this makes sure a number that
 * still is not a number never reaches the database.
 */
const phoneIn = (value) => {
  const text = cleanText(value ?? '', 40);
  if (!text) return null;
  return formatPhone(text);
};

/** True when the phone can be dialled as it is written. */
const phoneOk = (value) => isValidPhone(value);

function readPartForm(body) {
  return {
    title: cleanText(body.title ?? '', 90),
    category: parts.isCategory(body.category) ? body.category : 'other',
    price: priceIn(body.price),
    currency: normalizeCurrency(body.currency) ?? 'GEL',
    priceNote: cleanText(body.price_note ?? '', 40) || null,
    description: cleanText(body.description ?? '', 4000) || null,
    phone: phoneIn(body.phone) || null,
    location: cleanText(body.location ?? '', 120) || null,
    status: body.status === 'sold' ? 'sold' : 'available',
  };
}

function readServiceForm(body) {
  const coords = checkCoords(body.lat, body.lng);
  return {
    title: cleanText(body.title ?? '', 90),
    category: maintenance.isCategory(body.category) ? body.category : 'other',
    description: cleanText(body.description ?? '', 2000) || null,
    phone: phoneIn(body.phone) || null,
    email: cleanText(body.email ?? '', 254).toLowerCase() || null,
    placeName: cleanText(body.place_name ?? '', 160) || null,
    address: cleanText(body.address ?? '', 240) || null,
    lat: coords.ok ? coords.lat : null,
    lng: coords.ok ? coords.lng : null,
    zoom: coords.ok ? checkZoom(body.zoom) : null,
  };
}

/** Store uploaded photos for a part; the first becomes the cover. */
function savePartPhotos(partId, userId, files = [], startIndex = 0) {
  const saved = [];
  files.forEach((file, index) => {
    const kind = mediaKind(file.mimetype);
    if (kind !== 'photo') {
      removeUpload(file.filename);
      return;
    }
    parts.addPhoto({ partId, userId, mediaPath: file.filename, position: startIndex + index });
    saved.push(file.filename);
  });
  return saved;
}

const isOwnerOrAdmin = (row, user) => Boolean(row) && (row.user_id === user?.id || Boolean(user?.is_admin));

/* ── hub ──────────────────────────────────────────────────────── */
router.get('/services', (req, res) => {
  const site = req.app.locals.config.siteName;
  return res.page('services/index', {
    title: `Services - ${site}`,
    active: 'services',
    partCount: parts.countFor({}),
    serviceCount: maintenance.countFor({}),
    providerCount: users.providerCount(),
    recentParts: parts.recent(6),
    topServices: maintenance.topRated(4),
    partCategories: parts.CATEGORIES,
    serviceCategories: maintenance.CATEGORIES,
  });
});

/* ══ PART SEARCH ═══════════════════════════════════════════════════ */

/**
 * The parts catalogue: search by part number, cross reference or
 * keyword, or walk down a car until the parts are in front of you.
 */
router.get('/services/part-search', (req, res) => {
  const site = req.app.locals.config.siteName;
  return res.page('services/part-search', {
    title: `Part search - ${site}`,
    active: 'services',
    section: 'partsearch',
    pageScripts: [`/assets/${res.locals.assetStamp}/js/part-search.js`],
    q: cleanText(req.query.q ?? '', 80),
  });
});

/* ══ PARTS ═══════════════════════════════════════════════════════ */

router.get('/services/parts', (req, res) => {
  const site = req.app.locals.config.siteName;
  const viewerId = req.user?.id ?? 0;
  const scope = PART_SCOPES[req.query.scope] ? req.query.scope : 'all';
  const sort = PART_SORTS[req.query.sort] ? req.query.sort : 'new';
  const category = parts.isCategory(req.query.category) ? req.query.category : '';
  const q = cleanText(req.query.q ?? '', 80);
  const { page, perPage, offset } = pagination(req.query, { perPage: PER_PAGE });
  const effectiveScope = scope;

  const items = parts.feed({ scope: effectiveScope, viewerId, category, q, sort, limit: perPage, offset });
  const total = parts.countFor({ scope: effectiveScope, viewerId, category, q });

  const counts = new Map(parts.countsByCategory().map((row) => [row.category, row.n]));

  return res.page('services/parts/index', {
    title: `Parts - ${site}`,
    active: 'services',
    section: 'parts',
    items,
    total,
    page,
    hasMore: offset + items.length < total,
    scope: effectiveScope,
    scopes: PART_SCOPES,
    sort,
    sorts: PART_SORTS,
    category,
    q,
    categories: parts.CATEGORIES,
    counts,
  });
});

router.get('/services/parts/new', requireAuth, (req, res) =>
  res.page('services/parts/new', {
    title: `Sell a part - ${req.app.locals.config.siteName}`,
    active: 'services',
    section: 'parts',
    mode: 'new',
    action: '/services/parts/new',
    errors: {},
    values: { category: parts.isCategory(req.query.category) ? req.query.category : 'engine', status: 'available' },
    categories: parts.CATEGORIES,
  }),
);

router.post(
  '/services/parts/new',
  requireAuth,
  partUpload,
  optimizeAs('listing'),
  verifyCsrf,
  (req, res) => {
    const values = readPartForm(req.body);
    const errors = {};
    if (values.title.length < 3) errors.title = 'Give the part a clear name.';
    if (!req.files?.length) errors.media = 'Add at least one photo of the part.';
    if (!values.phone && !values.description) {
      errors.phone = 'Add a phone number so buyers can reach you (or a description).';
    }
    if (values.phone && !phoneOk(values.phone)) {
      errors.phone = 'The phone number must be {example}.', { example: PHONE_PLACEHOLDER };
    }

    if (Object.keys(errors).length) {
      (req.files || []).forEach((file) => removeUpload(file.filename));
      return res.status(400).page('services/parts/new', {
        title: `Sell a part - ${req.app.locals.config.siteName}`,
        active: 'services',
        section: 'parts',
        mode: 'new',
        action: '/services/parts/new',
        errors,
        values: { ...values, ...req.body },
        categories: parts.CATEGORIES,
      });
    }

    const partId = parts.createPart({ userId: req.user.id, ...values, cover: null });
    const saved = savePartPhotos(partId, req.user.id, req.files || []);
    if (saved.length) parts.updatePart(partId, { ...values, cover: saved[0] });

    req.flash('success', 'Part listed. Buyers can now see it.');
    return res.redirect(`/services/parts/${partId}`);
  },
);

router.get('/services/parts/:id', (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next();
  const viewerId = req.user?.id ?? 0;

  const part = parts.byId(id);
  if (!part) return next();

  return res.page('services/parts/show', {
    title: `${part.title} - ${req.app.locals.config.siteName}`,
    active: 'services',
    section: 'parts',
    part,
    photos: parts.photos(id),
    mine: part.user_id === viewerId,
    canModerate: Boolean(req.user?.is_admin),
    categories: parts.CATEGORIES,
    related: parts.feed({ category: part.category, limit: 5 }).filter((row) => row.id !== part.id),
  });
});

router.get('/services/parts/:id/edit', requireAuth, (req, res, next) => {
  const id = Number(req.params.id);
  const part = parts.byId(id);
  if (!part || !isOwnerOrAdmin(part, req.user)) {
    req.flash('error', 'You can only edit your own listings.');
    return res.redirect('/services/parts');
  }
  return res.page('services/parts/edit', {
    title: `Edit ${part.title} - ${req.app.locals.config.siteName}`,
    active: 'services',
    section: 'parts',
    mode: 'edit',
    action: `/services/parts/${id}/edit`,
    part,
    values: part,
    photos: parts.photos(id),
    errors: {},
    categories: parts.CATEGORIES,
  });
});

router.post(
  '/services/parts/:id/edit',
  requireAuth,
  partUpload,
  optimizeAs('listing'),
  verifyCsrf,
  (req, res, next) => {
    const id = Number(req.params.id);
    const part = parts.byId(id);
    if (!part || !isOwnerOrAdmin(part, req.user)) {
      (req.files || []).forEach((file) => removeUpload(file.filename));
      req.flash('error', 'You can only edit your own listings.');
      return res.redirect('/services/parts');
    }

    const values = readPartForm(req.body);
    const errors = {};
    if (values.title.length < 3) errors.title = 'Give the part a clear name.';
    if (values.phone && !phoneOk(values.phone)) {
      errors.phone = 'The phone number must be {example}.', { example: PHONE_PLACEHOLDER };
    }

    if (Object.keys(errors).length) {
      (req.files || []).forEach((file) => removeUpload(file.filename));
      return res.status(400).page('services/parts/edit', {
        title: `Edit ${part.title} - ${req.app.locals.config.siteName}`,
        active: 'services',
        section: 'parts',
        mode: 'edit',
        action: `/services/parts/${id}/edit`,
        part,
        values: { ...part, ...req.body, currency: values.currency },
        photos: parts.photos(id),
        errors,
        categories: parts.CATEGORIES,
      });
    }

    const existing = parts.photos(id).length;
    const saved = savePartPhotos(id, req.user.id, req.files || [], existing);
    const cover = part.cover ?? saved[0] ?? null;
    parts.updatePart(id, { ...values, cover });

    req.flash('success', 'Listing updated.');
    return res.redirect(`/services/parts/${id}`);
  },
);

router.post('/services/parts/:id/sold', requireAuth, verifyCsrf, (req, res, next) => {
  const id = Number(req.params.id);
  const part = parts.byId(id);
  if (!part) return next();
  if (!isOwnerOrAdmin(part, req.user)) {
    if (wantsJson(req)) return jsonError(res, 'You can only change your own listings.', 403);
    req.flash('error', 'You can only change your own listings.');
    return res.redirect(`/services/parts/${id}`);
  }

  const next_ = part.status === 'sold' ? 'available' : 'sold';
  parts.setStatus(id, next_);
  if (wantsJson(req)) return jsonOk(res, { status: next_ });
  req.flash('success', next_ === 'sold' ? 'Marked as sold.' : 'Back on the market.');
  return res.redirect(backTo(req, `/services/parts/${id}`));
});

router.post('/services/parts/:id/delete', requireAuth, verifyCsrf, (req, res, next) => {
  const id = Number(req.params.id);
  const part = parts.byId(id);
  if (!part) return next();
  const asModerator = Boolean(req.user.is_admin);
  const ok = parts.removePart(id, req.user.id, { asModerator });
  req.flash(ok ? 'success' : 'error', ok ? 'Listing deleted.' : 'You can only delete your own listings.');
  return res.redirect('/services/parts');
});

router.post('/services/parts/:id/photos/:photoId/delete', requireAuth, verifyCsrf, (req, res, next) => {
  const id = Number(req.params.id);
  const photoId = Number(req.params.photoId);
  const part = parts.byId(id);
  if (!part) return next();
  if (!isOwnerOrAdmin(part, req.user)) {
    req.flash('error', 'You can only edit your own listings.');
    return res.redirect('/services/parts');
  }
  parts.removePhoto(photoId, part.user_id, { asModerator: Boolean(req.user.is_admin) });
  req.flash('success', 'Photo removed.');
  return res.redirect(`/services/parts/${id}/edit`);
});

/* ══ MAINTENANCE ════════════════════════════════════════════════ */

router.get('/services/maintenance', (req, res) => {
  const site = req.app.locals.config.siteName;
  const viewerId = req.user?.id ?? 0;
  const scope = SERVICE_SCOPES[req.query.scope] ? req.query.scope : 'all';
  const sort = SERVICE_SORTS[req.query.sort] ? req.query.sort : 'new';
  const category = maintenance.isCategory(req.query.category) ? req.query.category : '';
  const q = cleanText(req.query.q ?? '', 80);
  const { page, perPage, offset } = pagination(req.query, { perPage: PER_PAGE });

  const items = maintenance.feed({ scope, viewerId, category, q, sort, limit: perPage, offset });
  const total = maintenance.countFor({ scope, viewerId, category, q });
  const counts = new Map(maintenance.countsByCategory().map((row) => [row.category, row.n]));

  return res.page('services/maintenance/index', {
    title: `Maintenance - ${site}`,
    active: 'services',
    section: 'maintenance',
    items,
    total,
    page,
    hasMore: offset + items.length < total,
    scope,
    scopes: SERVICE_SCOPES,
    sort,
    sorts: SERVICE_SORTS,
    category,
    q,
    categories: maintenance.CATEGORIES,
    counts,
  });
});

router.get('/services/maintenance/new', requireAuth, (req, res) =>
  res.page('services/maintenance/new', {
    title: `Offer a service - ${req.app.locals.config.siteName}`,
    active: 'services',
    section: 'maintenance',
    mode: 'new',
    action: '/services/maintenance/new',
    errors: {},
    values: {
      category: maintenance.isCategory(req.query.category) ? req.query.category : 'engine_mech',
      lat: req.query.lat ?? '',
      lng: req.query.lng ?? '',
    },
    isProvider: Boolean(req.user.is_provider),
    providerName: req.user.provider_name ?? '',
    categories: maintenance.CATEGORIES,
  }),
);

router.post(
  '/services/maintenance/new',
  requireAuth,
  serviceUpload,
  optimizeAs('listing'),
  verifyCsrf,
  (req, res) => {
    const values = readServiceForm(req.body);
    const errors = {};
    if (values.title.length < 3) errors.title = 'Give the service a name.';
    if (!values.phone && !values.email) errors.phone = 'Add a phone number or an email so drivers can reach you.';
    if (values.phone && !phoneOk(values.phone)) {
      errors.phone = 'The phone number must be {example}.', { example: PHONE_PLACEHOLDER };
    }
    if (values.email && !checkEmail(values.email).ok) errors.email = 'Enter a valid email address.';
    if (!values.placeName && values.lat == null) {
      errors.place_name = 'Pin the shop on the map, or type where it is.';
    }

    if (Object.keys(errors).length) {
      if (req.file) removeUpload(req.file.filename);
      return res.status(400).page('services/maintenance/new', {
        title: `Offer a service - ${req.app.locals.config.siteName}`,
        active: 'services',
        section: 'maintenance',
        mode: 'new',
        action: '/services/maintenance/new',
        errors,
        values: { ...values, ...req.body },
        isProvider: Boolean(req.user.is_provider),
        providerName: req.user.provider_name ?? '',
        categories: maintenance.CATEGORIES,
      });
    }

    const serviceId = maintenance.createService({
      userId: req.user.id,
      ...values,
      cover: req.file ? req.file.filename : null,
      // Any member may list a service to share it with others. The listing
      // only becomes "Verified" when an admin approves a claim on it.
      verified: 0,
    });

    // A provider who publishes their own listing does not have to claim it -
    // the claim is filed for them and an admin confirms it like any other.
    if (req.user.is_provider) {
      maintenance.createClaim(serviceId, req.user.id, null);
      // The admins have to know there is a claim waiting, exactly like
      // when somebody claims a listing that already exists.
      notifyAdminsAboutClaim({
        serviceId,
        serviceTitle: values.title,
        actorId: req.user.id,
        actorUsername: req.user.username,
      });
    }

    req.flash('success', 'Service published. Drivers can now find you.');
    return res.redirect(`/services/maintenance/${serviceId}`);
  },
);

router.get('/services/maintenance/:id', (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next();
  const viewerId = req.user?.id ?? 0;

  const service = maintenance.byId(id);
  if (!service) return next();

  return res.page('services/maintenance/show', {
    title: `${service.title} - ${req.app.locals.config.siteName}`,
    active: 'services',
    section: 'maintenance',
    service,
    reviews: maintenance.reviews(id),
    myReview: viewerId ? maintenance.myReview(id, viewerId) : null,
    mine: service.user_id === viewerId,
    canModerate: Boolean(req.user?.is_admin),
    categories: maintenance.CATEGORIES,
    related: maintenance.feed({ category: service.category, limit: 4 }).filter((row) => row.id !== service.id),
  });
});

router.get('/services/maintenance/:id/edit', requireAuth, (req, res, next) => {
  const id = Number(req.params.id);
  const service = maintenance.byId(id);
  if (!service || !isOwnerOrAdmin(service, req.user)) {
    req.flash('error', 'You can only edit your own listings.');
    return res.redirect('/services/maintenance');
  }
  return res.page('services/maintenance/edit', {
    title: `Edit ${service.title} - ${req.app.locals.config.siteName}`,
    active: 'services',
    section: 'maintenance',
    mode: 'edit',
    action: `/services/maintenance/${id}/edit`,
    service,
    values: service,
    errors: {},
    categories: maintenance.CATEGORIES,
  });
});

router.post(
  '/services/maintenance/:id/edit',
  requireAuth,
  serviceUpload,
  optimizeAs('listing'),
  verifyCsrf,
  (req, res, next) => {
    const id = Number(req.params.id);
    const service = maintenance.byId(id);
    if (!service || !isOwnerOrAdmin(service, req.user)) {
      if (req.file) removeUpload(req.file.filename);
      req.flash('error', 'You can only edit your own listings.');
      return res.redirect('/services/maintenance');
    }

    const values = readServiceForm(req.body);
    const errors = {};
    if (values.title.length < 3) errors.title = 'Give the service a name.';
    if (values.phone && !phoneOk(values.phone)) {
      errors.phone = 'The phone number must be {example}.', { example: PHONE_PLACEHOLDER };
    }
    if (values.email && !checkEmail(values.email).ok) errors.email = 'Enter a valid email address.';

    if (Object.keys(errors).length) {
      if (req.file) removeUpload(req.file.filename);
      return res.status(400).page('services/maintenance/edit', {
        title: `Edit ${service.title} - ${req.app.locals.config.siteName}`,
        active: 'services',
        section: 'maintenance',
        mode: 'edit',
        action: `/services/maintenance/${id}/edit`,
        service,
        values: { ...service, ...req.body },
        errors,
        categories: maintenance.CATEGORIES,
      });
    }

    if (req.file && service.cover) removeUpload(service.cover);
    maintenance.updateService(id, { ...values, cover: req.file ? req.file.filename : null, verified: Boolean(req.user.is_provider && service.user_id === req.user.id) });

    req.flash('success', 'Service updated.');
    return res.redirect(`/services/maintenance/${id}`);
  },
);

router.post('/services/maintenance/:id/delete', requireAuth, verifyCsrf, (req, res, next) => {
  const id = Number(req.params.id);
  const service = maintenance.byId(id);
  if (!service) return next();
  const asModerator = Boolean(req.user.is_admin);
  const ok = maintenance.removeService(id, req.user.id, { asModerator });
  req.flash(ok ? 'success' : 'error', ok ? 'Service deleted.' : 'You can only delete your own listings.');
  return res.redirect('/services/maintenance');
});

/* ── claim ownership ───────────────────────────────────────────── */
router.post('/services/maintenance/:id/claim', requireAuth, verifyCsrf, (req, res, next) => {
  const id = Number(req.params.id);
  const service = maintenance.byId(id);
  if (!service) return next();

  // Only a declared service provider can claim a listing. The button is
  // hidden for everyone else, so the route checks it too.
  if (!req.user.is_provider) {
    req.flash('error', 'Turn on "I offer car services" in your settings first, then you can claim this listing.');
    return res.redirect(`/services/maintenance/${id}`);
  }

  // Can't claim your own listing
  if (service.user_id === req.user.id) {
    req.flash('error', 'You already own this listing.');
    return res.redirect(`/services/maintenance/${id}`);
  }

  // Already has a pending claim
  const existing = maintenance.getClaim(id, req.user.id);
  if (existing && existing.status === 'pending') {
    req.flash('info', 'You already submitted a claim for this service.');
    return res.redirect(`/services/maintenance/${id}`);
  }

  // Must be a service provider to claim
  if (!req.user.is_provider) {
    req.flash('error', 'Only service providers can claim listings. Enable "I offer car services" in Settings.');
    return res.redirect(`/services/maintenance/${id}`);
  }

  // If there's an old rejected/approved claim, delete it first
  if (existing) {
    run('DELETE FROM service_claims WHERE service_id = ? AND claimant_id = ?', id, req.user.id);
  }

  const message = cleanText(req.body.message || '', 500) || null;
  maintenance.createClaim(id, req.user.id, message);

  // Notify admins
  notifyAdminsAboutClaim({
    serviceId: id,
    serviceTitle: service.title,
    actorId: req.user.id,
    actorUsername: req.user.username,
  });

  req.flash('success', 'Claim submitted. Admins will review your request.');
  return res.redirect(`/services/maintenance/${id}`);
});

/* ── reviews ──────────────────────────────────────────────────── */
router.post('/services/maintenance/:id/review', requireAuth, verifyCsrf, (req, res, next) => {
  const id = Number(req.params.id);
  const service = maintenance.byId(id);
  if (!service) return next();

  if (service.user_id === req.user.id) {
    if (wantsJson(req)) return jsonError(res, 'You cannot review your own service.');
    req.flash('error', 'You cannot review your own service.');
    return res.redirect(`/services/maintenance/${id}`);
  }

  const rating = Number.parseInt(req.body.rating, 10);
  const body = cleanText(req.body.body ?? '', 1200);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    if (wantsJson(req)) return jsonError(res, 'Pick a rating from 1 to 5 stars.');
    req.flash('error', 'Pick a rating from 1 to 5 stars.');
    return res.redirect(`/services/maintenance/${id}`);
  }

  const summary = maintenance.saveReview({ serviceId: id, userId: req.user.id, rating, body });
  if (wantsJson(req)) return jsonOk(res, { rating, count: summary.n, average: summary.avg });
  req.flash('success', 'Thanks for the review.');
  return res.redirect(`/services/maintenance/${id}#reviews`);
});

router.post('/services/maintenance/:id/review/delete', requireAuth, verifyCsrf, (req, res, next) => {
  const id = Number(req.params.id);
  const service = maintenance.byId(id);
  if (!service) return next();
  maintenance.removeReview(id, req.user.id);
  req.flash('success', 'Review removed.');
  return res.redirect(`/services/maintenance/${id}#reviews`);
});

export default router;
