import express from 'express';
import config from '../config.js';
import * as builds from '../models/builds.js';
import * as timeline from '../models/build-timeline.js';
import * as vehicles from '../models/vehicles.js';
import * as users from '../models/users.js';
import * as notifications from '../models/notifications.js';
import { requireAuth } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { buildUpload, timelineUpload, removeUpload, mediaKind, uploadUrl, optimizeAs } from '../lib/uploads.js';
import { wantsJson, jsonOk, jsonError, pagination, backTo } from '../lib/http.js';
import { cleanText } from '../lib/validate.js';
import { removeUploadIfUnused } from '../lib/media-refs.js';
import { certificateFields, certificateSpecs } from '../lib/certificate.js';
import { lookupPti, normalizePlate, ptiNeedsCheck } from '../lib/pti.js';
import { normalizeCurrency } from '../lib/currency.js';
import { currentWeek, currentMonth, currentYear, weekLabel, monthLabel, PERIOD_LABELS } from '../lib/periods.js';

const router = express.Router();

const PER_PAGE = 18;
const SCOPES = ['all', 'sale', 'mine', 'winners'];
const SORTS = ['new', 'top', 'week'];

/* ── tiny form helpers ────────────────────────────────────────── */
const intIn = (value, min, max) => {
  const n = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
};

/** Whole units of currency. Empty or junk -> null ("ask"). */
const priceIn = (value) => {
  const raw = String(value ?? '').replace(/[^\d.]/g, '').trim();
  if (!raw) return null;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 0 || n > 100_000_000) return null;
  return n;
};

const boolText = (value, max = 600) => {
  const text = cleanText(value, max);
  return text || null;
};

/** Owner or public visibility decides who may open a build. */
const canView = (build, viewerId) => Boolean(build) && (build.visibility === 'public' || build.user_id === viewerId);
const isOwner = (build, viewerId) => Boolean(build) && build.user_id === viewerId;

/** A build is "on the market" when it is public *and* ticked for sale. */
const onMarket = (build) => Boolean(build) && (build.for_sale === 1 || build.forSale === 1) && build.visibility === 'public';

/**
 * Tell everyone following this build that it just went on the market.
 * Only fires on the transition (private -> public, or unticked -> ticked),
 * so re-saving an existing listing does not spam the watchers.
 */
function announceForSale(build, owner) {
  const fans = builds.watchers(build.id, owner.id);
  if (!fans.length) return;

  const label = [build.year, build.make, build.model].filter(Boolean).join(' ') || build.title;
  fans.forEach((fan) => {
    notifications.notify({
      userId: fan.user_id,
      actorId: owner.id,
      type: 'build_sale',
      entityId: build.id,
      url: `/builds/${build.id}`,
      text: 'put {name} up for sale|' + label,
    });
  });
}

/** Notify watchers that the build was updated (specs, description, etc.). */
function announceUpdate(build, owner, changes) {
  const fans = builds.watchers(build.id, owner.id);
  if (!fans.length) return;

  const label = [build.year, build.make, build.model].filter(Boolean).join(' ') || build.title;
  fans.forEach((fan) => {
    notifications.notify({
      userId: fan.user_id,
      actorId: owner.id,
      type: 'build_update',
      entityId: build.id,
      url: `/builds/${build.id}`,
      text: 'updated their build {name}|' + label,
    });
  });
}

/** Notify watchers that new photos were added to the build. */
function announcePhotos(build, owner, count) {
  const fans = builds.watchers(build.id, owner.id);
  if (!fans.length) return;

  const label = [build.year, build.make, build.model].filter(Boolean).join(' ') || build.title;
  fans.forEach((fan) => {
    notifications.notify({
      userId: fan.user_id,
      actorId: owner.id,
      type: 'build_photo',
      entityId: build.id,
      url: `/builds/${build.id}`,
      text: 'added {n} new photo{plural} to {name}|' + count + '|' + (count === 1 ? '' : 's') + '|' + label,
    });
  });
}

/** Read the shared spec-sheet fields out of a submitted form. */
function readForm(body) {
  const cert = certificateFields(body);
  return {
    title: cleanText(body.title ?? '', 90),
    make: cert.make,
    model: cert.model,
    year: intIn(body.year, 1900, new Date().getFullYear() + 2),
    engine: boolText(body.engine, 80),
    drivetrain: boolText(body.drivetrain, 40),
    transmission: boolText(body.transmission, 40),
    powerHp: intIn(body.power_hp, 0, 5000),
    torqueNm: intIn(body.torque_nm, 0, 5000),
    weightKg: intIn(body.weight_kg, 0, 5000),
    odometerKm: intIn(body.odometer_km, 0, 10_000_000),
    mods: boolText(body.mods, 1200),
    description: boolText(body.description, 4000),
    visibility: body.visibility === 'private' ? 'private' : 'public',
    forSale: body.for_sale ? 1 : 0,
    price: priceIn(body.price),
    currency: normalizeCurrency(body.currency) ?? 'GEL',
    priceNote: cleanText(body.price_note ?? '', 40) || null,
    numberPlate: cert.numberPlate,
    technicalPassport: cert.technicalPassport,
    registrationDate: cert.registrationDate,
    ownerSurname: cert.ownerSurname,
    ownerName: cert.ownerName,
    ownerAddress: cert.ownerAddress,
    ownerId: cert.ownerId,
    ownerOfVehicle: cert.ownerOfVehicle,
    expiryDate: cert.expiryDate,
    vehicleType: cert.vehicleType,
    vin: cert.vin,
    maxLadenMass: cert.maxLadenMass,
    permissibleMass: cert.permissibleMass,
    unladenMass: cert.unladenMass,
    engineCapacity: cert.engineCapacity,
    netPowerKw: cert.netPowerKw,
    fuelType: cert.fuelType,
    engineNumber: cert.engineNumber,
    powerWeightRatio: cert.powerWeightRatio,
    colour: cert.colour,
    seats: cert.seats,
    standingPlaces: cert.standingPlaces,
  };
}

const hasValue = (value) => value !== undefined && value !== null && value !== '';

/** Fill only empty fields, so a value the owner typed wins over the pull. */
function fillFromCertificate(values, certificate) {
  const merged = { ...values };
  for (const [key, value] of Object.entries(certificate)) {
    if (!hasValue(value) || hasValue(merged[key])) continue;
    merged[key] = value;
  }
  return merged;
}

/** A build may only link to a vehicle the same member owns. */
function linkedVehicle(body, userId) {
  const id = Number(body.linked_vehicle_id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const vehicle = vehicles.findById(id);
  return vehicle && vehicle.user_id === userId ? vehicle : null;
}

/** Keep the vehicle side of the link in step with the build. */
function syncLinkedVehicle(buildId, vehicleId, userId) {
  if (!vehicleId) return;
  const vehicle = vehicles.findById(vehicleId);
  if (vehicle && vehicle.user_id === userId) vehicles.update(vehicleId, { linkedBuildId: buildId });
}

/** Keep the linked vehicle's certificate in step with the build. */
function syncVehicleCertificate(vehicleId, userId, values) {
  if (!vehicleId) return;
  const vehicle = vehicles.findById(vehicleId);
  if (!vehicle || vehicle.user_id !== userId) return;
  // My Ride also keeps a short engine/power/weight summary derived from the
  // certificate, so refresh those alongside the shared document fields.
  vehicles.applyCertificate(vehicleId, { ...values, ...certificateSpecs(values) });
  // The odometer is not printed on the certificate, but it is shared with
  // My Ride: a value typed in the build editor wins, an empty field leaves
  // the vehicle's reading alone.
  if (values.odometerKm != null) {
    vehicles.update(vehicleId, { currentMileage: values.odometerKm });
  }
}

/** Refresh the technical-inspection snapshot for a build and its vehicle. */
async function refreshBuildPti(buildId, plate, linkedVehicleId) {
  if (!config.ptiLookup) return null;
  try {
    const result = await lookupPti(plate);
    if (!result) return null;
    builds.setPti(buildId, result);
    if (linkedVehicleId) vehicles.setPti(linkedVehicleId, result);
    return result;
  } catch (error) {
    console.warn('[pti] could not refresh build', buildId, error.message);
    return null;
  }
}

/** Drop a stale reverse link when the build moves to another vehicle. */
function releaseVehicle(vehicleId, buildId, userId) {
  if (!vehicleId) return;
  const vehicle = vehicles.findById(vehicleId);
  if (vehicle && vehicle.user_id === userId && vehicle.linked_build_id === buildId) {
    vehicles.update(vehicleId, { linkedBuildId: null });
  }
}

/** Store the uploaded files as build media; first one becomes the cover. */
function saveUploads(buildId, userId, files = []) {
  const saved = [];
  files.forEach((file, index) => {
    const kind = mediaKind(file.mimetype);
    if (!kind) {
      removeUpload(file.filename);
      return;
    }
    builds.addMedia({ buildId, userId, mediaType: kind, mediaPath: file.filename, position: index });
    saved.push(file.filename);
  });
  return saved;
}

/* ── gallery ──────────────────────────────────────────────────── */
router.get('/builds', (req, res) => {
  // Decide any finished weeks before drawing the leaderboards.
  builds.recomputeAwards();

  const viewerId = req.user?.id ?? 0;
  const scope = SCOPES.includes(req.query.scope) ? req.query.scope : 'all';
  const sort = SORTS.includes(req.query.sort) ? req.query.sort : 'new';
  const { page, offset } = pagination(req.query, { perPage: PER_PAGE });

  const effectiveScope = scope === 'mine' && !viewerId ? 'all' : scope;

  const items = builds.feed({ scope: effectiveScope, viewerId, sort, limit: PER_PAGE, offset });
  const total = builds.countFor({ scope: effectiveScope, viewerId });

  return res.page('builds/index', {
    title: `Builds - ${req.app.locals.config.siteName}`,
    active: 'builds',
    scope: effectiveScope,
    sort,
    items,
    total,
    page,
    hasMore: offset + items.length < total,
    standings: builds.leaderboard(currentWeek(), 5),
    fame: builds.hallOfFame(),
    myVote: viewerId ? builds.myVote(viewerId) : null,
    weekLabel: weekLabel(currentWeek(), req.lang),
    monthLabel: monthLabel(currentMonth(), req.lang),
    yearLabel: currentYear(),
    scopes: { all: 'All builds', sale: 'For sale', winners: 'Hall of fame', ...(viewerId ? { mine: 'My builds' } : {}) },
    sorts: { new: 'Newest', week: 'This week', top: 'Most voted' },
  });
});

/* ── create ───────────────────────────────────────────────────── */
router.get('/builds/new', requireAuth, (req, res) =>
  res.page('builds/new', {
    title: `Add a build - ${req.app.locals.config.siteName}`,
    active: 'builds',
    values: { visibility: 'public' },
    errors: {},
    build: null,
    media: [],
    userVehicles: vehicles.listByUser(req.user.id),
  }),
);

router.post('/builds', requireAuth, buildUpload, optimizeAs('listing'), verifyCsrf, async (req, res) => {
  let values = readForm(req.body);
  const certVehicle = linkedVehicle(req.body, req.user.id);
  values.linkedVehicleId = certVehicle?.id ?? null;
  if (certVehicle && req.body.pull_certificate) {
    values = fillFromCertificate(values, builds.certificateToBuild(certVehicle));
    values.linkedVehicleId = certVehicle.id;
  }

  const errors = {};
  if (!values.title) errors.title = 'Give your build a name.';
  if (!req.files?.length && !values.description) {
    errors.media = 'Add at least one photo or clip (or write a description).';
  }

  if (Object.keys(errors).length) {
    (req.files || []).forEach((file) => removeUpload(file.filename));
    return res.status(400).page('builds/new', {
      title: `Add a build - ${req.app.locals.config.siteName}`,
      active: 'builds',
      values: { visibility: 'public', ...req.body },
      errors,
      build: null,
      media: [],
      userVehicles: vehicles.listByUser(req.user.id),
    });
  }

  const buildId = builds.createBuild({ userId: req.user.id, ...values, cover: null });
  const saved = saveUploads(buildId, req.user.id, req.files || []);
  if (saved.length) builds.updateBuild(buildId, { ...values, cover: saved[0] });

  if (certVehicle) {
    syncLinkedVehicle(buildId, certVehicle.id, req.user.id);
    syncVehicleCertificate(certVehicle.id, req.user.id, values);
  }
  await refreshBuildPti(buildId, values.numberPlate || certVehicle?.number_plate, certVehicle?.id);

  req.flash('success', 'Build added. Share it and collect votes for build of the week.');
  return res.redirect(`/builds/${buildId}`);
});

/* ── one build ────────────────────────────────────────────────── */
router.get('/builds/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return next();
  const viewerId = req.user?.id ?? 0;

  let build = builds.byId(id, viewerId);
  if (!build || !canView(build, viewerId)) return next();

  builds.recomputeAwards();

  const mine = isOwner(build, viewerId);
  // The full certificate contains the owner's personal details, so it is
  // loaded for the owner only and never rendered on the public page.
  let linkedVehicle = mine && build.linked_vehicle_id
    ? vehicles.findById(build.linked_vehicle_id)
    : null;
  if (linkedVehicle && linkedVehicle.user_id !== build.user_id) linkedVehicle = null;

  // Keep the owner's view fresh. Public visitors only see the stored
  // snapshot, so a busy build page never turns into a pti.ge proxy.
  if (mine && config.ptiLookup) {
    const source = build.number_plate ? build : linkedVehicle;
    if (source && ptiNeedsCheck(source)) {
      const plate = normalizePlate(build.number_plate || linkedVehicle?.number_plate);
      if (plate) {
        await refreshBuildPti(build.id, plate, linkedVehicle?.id);
        build = builds.byId(id, viewerId);
        linkedVehicle = build?.linked_vehicle_id
          ? vehicles.findById(build.linked_vehicle_id)
          : null;
        if (linkedVehicle && linkedVehicle.user_id !== build.user_id) linkedVehicle = null;
      }
    }
  }
  if (!build) return next();

  return res.page('builds/show', {
    title: `${build.title} - ${req.app.locals.config.siteName}`,
    active: 'builds',
    build,
    media: builds.media(id),
    awards: builds.awardsFor(id),
    owner: users.findById(build.user_id),
    mine,
    linkedVehicle: linkedVehicle && linkedVehicle.user_id === build.user_id ? linkedVehicle : null,
    standings: builds.leaderboard(currentWeek(), 5),
    myVote: viewerId ? builds.myVote(viewerId) : null,
    weekLabel: weekLabel(currentWeek(), req.lang),
    periodLabels: PERIOD_LABELS,
    weekKey: currentWeek(),
    // The history of the build - what was done, and when.
    timeline: timeline.list(id),
    timelineSummary: timeline.summary(id),
    og: {
      title: `${build.title} - STREETO build`,
      description: [[build.year, build.make, build.model].filter(Boolean).join(' '), build.engine]
        .filter(Boolean)
        .join(' · ') || `@${build.username}'s build`,
      image: `/og/build/${build.id}.png`,
      type: 'article',
      url: `/builds/${build.id}`,
    },
  });
});

/* ── edit ─────────────────────────────────────────────────────── */
router.get('/builds/:id/edit', requireAuth, (req, res, next) => {
  const id = Number(req.params.id);
  const build = builds.byId(id, req.user.id);
  if (!build || !isOwner(build, req.user.id)) {
    req.flash('error', 'You can only edit your own builds.');
    return res.redirect('/builds');
  }
  return res.page('builds/edit', {
    title: `Edit ${build.title} - ${req.app.locals.config.siteName}`,
    active: 'builds',
    build,
    // A linked certificate is always "active", so keep the pull box ticked
    // when the edit form opens. The checkbox itself is still just a helper:
    // unchecking it on a save only skips that one pull.
    values: { ...build, pull_certificate: build.linked_vehicle_id ? '1' : '' },
    media: builds.media(id),
    errors: {},
    userVehicles: vehicles.listByUser(req.user.id),
    // The history of the build, so the owner can keep it up to date.
    timeline: timeline.list(id),
    timelineSummary: timeline.summary(id),
  });
});

router.post('/builds/:id', requireAuth, buildUpload, optimizeAs('listing'), verifyCsrf, async (req, res, next) => {
  const id = Number(req.params.id);
  const build = builds.byId(id, req.user.id);
  if (!build || !isOwner(build, req.user.id)) {
    (req.files || []).forEach((file) => removeUpload(file.filename));
    req.flash('error', 'You can only edit your own builds.');
    return res.redirect('/builds');
  }

  let values = readForm(req.body);
  const certVehicle = linkedVehicle(req.body, req.user.id);
  values.linkedVehicleId = certVehicle?.id ?? null;
  if (certVehicle && req.body.pull_certificate) {
    values = fillFromCertificate(values, builds.certificateToBuild(certVehicle));
    values.linkedVehicleId = certVehicle.id;
  }

  const errors = {};
  if (!values.title) errors.title = 'Give your build a name.';

  if (Object.keys(errors).length) {
    (req.files || []).forEach((file) => removeUpload(file.filename));
    return res.status(400).page('builds/edit', {
      title: `Edit ${build.title} - ${req.app.locals.config.siteName}`,
      active: 'builds',
      build,
      values: { ...build, ...req.body, for_sale: values.forSale, price: values.price, currency: values.currency, price_note: values.priceNote },
      media: builds.media(id),
      errors,
      userVehicles: vehicles.listByUser(req.user.id),
    });
  }

  const saved = saveUploads(id, req.user.id, req.files || []);
  const hadPhotos = build.media_count > 0;
  builds.updateBuild(id, { ...values, cover: saved[0] ?? null });

  // The link is two-way: repoint (or clear) the old vehicle and remember
  // this build on the newly linked one.
  if (build.linked_vehicle_id && build.linked_vehicle_id !== values.linkedVehicleId) {
    releaseVehicle(build.linked_vehicle_id, id, req.user.id);
  }
  if (values.linkedVehicleId) {
    syncLinkedVehicle(id, values.linkedVehicleId, req.user.id);
    syncVehicleCertificate(values.linkedVehicleId, req.user.id, values);
  }
  await refreshBuildPti(id, values.numberPlate || certVehicle?.number_plate, certVehicle?.id);

  // Ticking "for sale" (or making a private listing public) puts the car on
  // the market - that is the moment the people following it want to hear.
  if (!onMarket(build) && onMarket(values)) {
    announceForSale({ id, ...values }, { id: req.user.id });
  }

  // If the build had meaningful changes (beyond just cover/media), ping watchers.
  const changed = [];
  if (values.title !== build.title) changed.push(req.t('title'));
  if (values.make !== build.make) changed.push(req.t('make'));
  if (values.model !== build.model) changed.push(req.t('model'));
  if (values.year !== build.year) changed.push(req.t('year'));
  if (values.engine !== build.engine) changed.push(req.t('engine'));
  if (values.drivetrain !== build.drivetrain) changed.push(req.t('drivetrain'));
  if (values.transmission !== build.transmission) changed.push(req.t('transmission'));
  if (values.powerHp !== build.power_hp) changed.push(req.t('power'));
  if (values.torqueNm !== build.torque_nm) changed.push(req.t('torque'));
  if (values.weightKg !== build.weight_kg) changed.push(req.t('weight'));
  if (values.odometerKm !== build.odometer_km) changed.push(req.t('odometer'));
  if (values.mods !== build.mods) changed.push(req.t('mods'));
  if (values.description !== build.description) changed.push(req.t('story'));
  if (values.visibility !== build.visibility) changed.push(req.t('visibility'));
  if (values.price !== build.price || values.currency !== build.currency || values.priceNote !== build.price_note) {
    if (!onMarket(build) || !onMarket(values)) changed.push(req.t('price'));
  }

  if (changed.length) {
    announceUpdate({ id, ...values }, { id: req.user.id }, changed.join(', '));
  }

  // If new photos were uploaded (not just a cover change), notify watchers.
  const newPhotoCount = (req.files || []).filter((f) => f.mimetype?.startsWith('image/')).length;
  if (newPhotoCount > 0) {
    announcePhotos({ id, ...values }, { id: req.user.id }, newPhotoCount);
  }

  req.flash('success', 'Build updated.');
  return res.redirect(`/builds/${id}`);
});

router.post('/builds/:id/delete', requireAuth, verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  const asModerator = Boolean(req.user.is_admin);
  const build = builds.byId(id, req.user.id);
  const ownsLinkedVehicle = Boolean(build && build.user_id === req.user.id && build.linked_vehicle_id);
  let linkedVehicleId = ownsLinkedVehicle ? build.linked_vehicle_id : null;

  if (linkedVehicleId) {
    const vehicle = vehicles.findById(linkedVehicleId);
    if (vehicle && vehicle.user_id === req.user.id) {
      const photo = vehicle.photo;
      vehicles.remove(linkedVehicleId);
      removeUploadIfUnused(photo);
    } else {
      linkedVehicleId = null;
    }
  }

  const ok = builds.removeBuild(id, req.user.id, { asModerator });
  const message = ok
    ? (linkedVehicleId ? 'Build and linked My Ride vehicle deleted.' : 'Build deleted.')
    : 'You can only delete your own builds.';
  req.flash(ok ? 'success' : 'error', message);
  return res.redirect('/builds');
});

router.post('/builds/:id/media/:mediaId/delete', requireAuth, verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  const mediaId = Number(req.params.mediaId);
  const build = builds.byId(id, req.user.id);
  if (!build || !isOwner(build, req.user.id)) {
    req.flash('error', 'You can only edit your own builds.');
    return res.redirect('/builds');
  }
  builds.removeMedia(mediaId, req.user.id);
  req.flash('success', 'File removed.');
  return res.redirect(`/builds/${id}/edit`);
});

/* ── the timeline: what was done to the car, and when ──────────── */
router.post('/builds/:id/timeline', requireAuth, timelineUpload, optimizeAs('listing'), verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  const build = builds.byId(id, req.user.id);
  if (!build || !isOwner(build, req.user.id)) {
    req.flash('error', 'You can only edit your own builds.');
    return res.redirect('/builds');
  }
  const title = String(req.body.title ?? '').trim();
  if (!title) {
    req.flash('error', 'Say what was done.');
    return res.redirect(`/builds/${id}/edit`);
  }
  const mileage = Number(req.body.mileage);
  const cost = Number(req.body.cost);
  const changedAt = String(req.body.changed_at ?? '').trim();
  timeline.add({
    buildId: id,
    userId: req.user.id,
    title,
    kind: String(req.body.kind ?? 'other'),
    description: String(req.body.description ?? '').trim() || null,
    mileage: Number.isFinite(mileage) && mileage > 0 ? mileage : null,
    cost: Number.isFinite(cost) && cost > 0 ? cost : null,
    photo: req.file?.filename || null,
    changedAt: /^\d{4}-\d{2}-\d{2}$/.test(changedAt) ? changedAt : null,
  });
  req.flash('success', 'Added to the timeline.');
  return res.redirect(`/builds/${id}/edit#timeline`);
});

/* Change one entry of the timeline. */
router.post('/builds/:id/timeline/:itemId', requireAuth, timelineUpload, optimizeAs('listing'), verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const build = builds.byId(id, req.user.id);
  const item = timeline.byId(itemId);
  if (!build || !isOwner(build, req.user.id) || !item || item.build_id !== id) {
    req.flash('error', 'You can only edit your own builds.');
    return res.redirect('/builds');
  }
  const title = String(req.body.title ?? '').trim();
  if (!title) {
    req.flash('error', 'Say what was done.');
    return res.redirect(`/builds/${id}/edit`);
  }
  const mileage = Number(req.body.mileage);
  const cost = Number(req.body.cost);
  const changedAt = String(req.body.changed_at ?? '').trim();
  timeline.update(itemId, {
    title,
    kind: String(req.body.kind ?? item.kind),
    description: String(req.body.description ?? '').trim() || null,
    mileage: Number.isFinite(mileage) && mileage > 0 ? mileage : null,
    cost: Number.isFinite(cost) && cost > 0 ? cost : null,
    photo: req.file?.filename || item.photo,
    changedAt: /^\d{4}-\d{2}-\d{2}$/.test(changedAt) ? changedAt : item.changed_at,
  });
  req.flash('success', 'Timeline entry updated.');
  return res.redirect(`/builds/${id}/edit#timeline`);
});

/* Take one entry out of the timeline. */
router.post('/builds/:id/timeline/:itemId/delete', requireAuth, verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const build = builds.byId(id, req.user.id);
  const item = timeline.byId(itemId);
  if (!build || !isOwner(build, req.user.id) || !item || item.build_id !== id) {
    req.flash('error', 'You can only edit your own builds.');
    return res.redirect('/builds');
  }
  timeline.remove(itemId);
  req.flash('success', 'Timeline entry removed.');
  return res.redirect(`/builds/${id}/edit#timeline`);
});

/* ── watch a build so you hear when it goes up for sale ───────── */
router.post('/builds/:id/watch', requireAuth, verifyCsrf, (req, res) => {
  const id = Number(req.params.id);
  const build = builds.byId(id, req.user.id);
  if (!build || !canView(build, req.user.id)) {
    if (wantsJson(req)) return jsonError(res, 'That build is not available.', 404);
    req.flash('error', 'That build is not available.');
    return res.redirect('/builds');
  }
  if (isOwner(build, req.user.id)) {
    if (wantsJson(req)) return jsonError(res, 'You cannot follow your own build.');
    req.flash('error', 'You cannot follow your own build.');
    return res.redirect(`/builds/${id}`);
  }

  const watching = builds.toggleWatch(id, req.user.id);

  if (wantsJson(req)) {
    return jsonOk(res, { watching, watchers: builds.byId(id, req.user.id).watcher_count });
  }
  req.flash('success', watching
    ? req.t('Noted. We will tell you when this car goes up for sale.')
    : req.t('This car is off your watch list.'));
  return res.redirect(backTo(req, `/builds/${id}`));
});

/* ── vote for build of the week ───────────────────────────────── */
router.post('/builds/:id/vote', requireAuth, verifyCsrf, (req, res, next) => {
  const id = Number(req.params.id);
  const build = builds.byId(id, req.user.id);
  if (!build || !canView(build, req.user.id)) {
    if (wantsJson(req)) return jsonError(res, 'That build is not available.', 404);
    req.flash('error', 'That build is not available.');
    return res.redirect('/builds');
  }
  if (isOwner(build, req.user.id)) {
    if (wantsJson(req)) return jsonError(res, 'You cannot vote for your own build.');
    req.flash('error', 'You cannot vote for your own build.');
    return res.redirect(`/builds/${id}`);
  }

  const result = builds.vote(id, req.user.id, currentWeek());
  const fresh = builds.byId(id, req.user.id);

  if (result.voted) {
    notifications.notify({
      userId: build.user_id,
      actorId: req.user.id,
      type: 'build_vote',
      entityId: id,
      url: `/builds/${id}`,
      text: 'voted for your build',
    });
  }

  if (wantsJson(req)) {
    return jsonOk(res, {
      voted: result.voted,
      moved: result.moved,
      votes: fresh.vote_count,
      weekVotes: fresh.week_votes,
      myVote: builds.myVote(req.user.id)?.build_id ?? null,
    });
  }

  req.flash('success', result.voted
    ? (result.moved
      ? req.t('Vote moved to this build for this week.')
      : req.t('Vote locked in for {name}.', { name: build.title }))
    : 'Vote withdrawn.');
  return res.redirect(backTo(req, `/builds/${id}`));
});

export default router;
