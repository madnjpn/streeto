import express from 'express';
import config from '../config.js';
import * as vehicles from '../models/vehicles.js';
import * as builds from '../models/builds.js';
import * as users from '../models/users.js';
import { requireAuth } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { wantsJson, jsonOk, jsonError } from '../lib/http.js';
import { renderView } from '../lib/views.js';
import { cleanText } from '../lib/validate.js';
import { vehicleUpload, removeUpload, mediaKind, optimizeAs } from '../lib/uploads.js';
import { removeUploadIfUnused } from '../lib/media-refs.js';
import { certificateFields, certificateSpecs } from '../lib/certificate.js';
import { lookupPti, normalizePlate as normalizePtiPlate, ptiNeedsCheck } from '../lib/pti.js';
import { lookupFines, isFinesAvailable, normalizePlate, describeError, paymentUrl, libertyPaymentUrl, describePaymentError } from '../lib/fines.js';

const router = express.Router();

/** Look up one plate and store the result on every vehicle/build using it. */
async function refreshPtiForPlate(plate, { vehicleIds = [], buildIds = [] } = {}) {
  if (!config.ptiLookup) return null;
  try {
    const result = await lookupPti(plate);
    if (!result) return null;
    vehicleIds.forEach((id) => vehicles.setPti(id, result));
    buildIds.forEach((id) => builds.setPti(id, result));
    return result;
  } catch (error) {
    console.warn('[pti] could not refresh plate', normalizePtiPlate(plate), error.message);
    return null;
  }
}

// Hub page
router.get('/garage', (req, res) => {
  const userId = req.user?.id ?? 0;
  return res.page('garage/index', {
    title: `My Garage - ${req.app.locals.config.siteName}`,
    active: 'garage',
    vehicles: userId ? vehicles.listByUser(userId) : [],
  });
});

// My Ride page
router.get('/garage/ride', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const userBuilds = builds.feed({ scope: 'mine', viewerId: userId });
  let userVehicles = vehicles.listByUser(userId);

  // Refresh stale inspection snapshots, once per plate, before rendering.
  // This is owner-only and TTL-limited, so pti.ge is never hit by visitors.
  if (config.ptiLookup) {
    const groups = new Map();
    for (const vehicle of userVehicles) {
      if (!ptiNeedsCheck(vehicle)) continue;
      const plate = normalizePtiPlate(vehicle.number_plate);
      if (!plate) continue;
      if (!groups.has(plate)) groups.set(plate, { plate, vehicleIds: [], buildIds: [] });
      const group = groups.get(plate);
      group.vehicleIds.push(vehicle.id);
      if (vehicle.linked_build_id) group.buildIds.push(vehicle.linked_build_id);
    }
    if (groups.size) {
      await Promise.allSettled(
        [...groups.values()].map((group) => refreshPtiForPlate(group.plate, group)),
      );
      userVehicles = vehicles.listByUser(userId);
    }
  }

  return res.page('garage/ride', {
    title: `My Ride - ${req.app.locals.config.siteName}`,
    active: 'garage',
    vehicles: userVehicles,
    userBuilds,
  });
});

// Add vehicle from its registration certificate
router.post('/garage/ride', requireAuth, vehicleUpload, optimizeAs('vehicle'), verifyCsrf, async (req, res) => {
  const userId = req.user.id;
  const certificate = certificateFields(req.body);

  // The certificate is the whole form now: fall back to "Make Model" when
  // no nickname was typed.
  const fallbackName = [certificate.make, certificate.model].filter(Boolean).join(' ').trim();
  const name = cleanText(req.body.title ?? '', 90) || fallbackName;
  if (!name) {
    req.flash('error', 'Add the make and model (or a name) from the certificate.');
    return res.redirect('/garage/ride');
  }

  let photo = null;
  if (req.file) {
    const kind = mediaKind(req.file.mimetype);
    if (!kind || kind !== 'photo') {
      removeUpload(req.file.filename);
      req.flash('error', 'That file type is not supported.');
      return res.redirect('/garage/ride');
    }
    photo = req.file.filename;
  }

  // Link to a build: only the owner's own builds may be linked.
  const createBuildFromVehicle = Boolean(req.body.create_build);
  const linkedBuildId = createBuildFromVehicle ? null : (req.body.linked_build_id ? Number(req.body.linked_build_id) : null);
  const linkedBuild = linkedBuildId ? builds.byId(linkedBuildId, userId) : null;
  const ownsBuild = Boolean(linkedBuild && linkedBuild.user_id === userId);
  // If no photo was uploaded but a build is linked, borrow its cover.
  if (!photo && ownsBuild && linkedBuild.cover) photo = linkedBuild.cover;

  // Preview specs are derived from the certificate so the card and search
  // stay in step with what the document says.
  const { engine, powerHp, weightKg } = certificateSpecs(certificate);

  const vehicleId = vehicles.create({
    userId,
    name,
    make: certificate.make || null,
    model: certificate.model || null,
    year: certificate.year || null,
    engine,
    drivetrain: null,
    transmission: null,
    powerHp,
    torqueNm: null,
    weightKg,
    mods: null,
    description: null,
    visibility: 'public',
    photo,
    numberPlate: certificate.numberPlate || null,
    technicalPassport: certificate.technicalPassport || null,
    currentMileage: ownsBuild && linkedBuild.odometer_km != null ? linkedBuild.odometer_km : 0,
    oilChangeMileage: null,
    oilChangeInterval: 5000,
    linkedBuildId: ownsBuild ? linkedBuildId : null,
  });
  // The certificate columns (owner details, VIN, masses, ...) sit outside
  // the base insert, so persist them in one update.
  vehicles.update(vehicleId, certificate);

  // Linking is two-way: the build remembers which vehicle it came from,
  // so its edit form can offer the same certificate again.
  if (ownsBuild) builds.setLinkedVehicle(linkedBuildId, vehicleId);

  // Optionally copy the whole certificate into the linked build.
  if (ownsBuild && req.body.sync_build) {
    builds.applyCertificate(linkedBuildId, {
      ...certificate,
      powerHp,
      weightKg,
    });
  }

  // Optionally create a brand-new build from this vehicle.
  if (createBuildFromVehicle) {
    const buildVisibility = req.body.build_visibility === 'private' ? 'private' : 'public';
    const buildValues = {
      title: name,
      make: certificate.make || null,
      model: certificate.model || null,
      year: certificate.year || null,
      engine: null,
      drivetrain: null,
      transmission: null,
      powerHp,
      torqueNm: null,
      weightKg,
      mods: null,
      description: null,
      visibility: buildVisibility,
      forSale: 0,
      price: null,
      currency: 'GEL',
      priceNote: null,
      numberPlate: certificate.numberPlate || null,
      technicalPassport: certificate.technicalPassport || null,
      registrationDate: certificate.registrationDate,
      ownerSurname: certificate.ownerSurname,
      ownerName: certificate.ownerName,
      ownerAddress: certificate.ownerAddress,
      ownerId: certificate.ownerId,
      ownerOfVehicle: certificate.ownerOfVehicle,
      expiryDate: certificate.expiryDate,
      vehicleType: certificate.vehicleType,
      vin: certificate.vin,
      maxLadenMass: certificate.maxLadenMass,
      permissibleMass: certificate.permissibleMass,
      unladenMass: certificate.unladenMass,
      engineCapacity: certificate.engineCapacity,
      netPowerKw: certificate.netPowerKw,
      fuelType: certificate.fuelType,
      engineNumber: certificate.engineNumber,
      powerWeightRatio: certificate.powerWeightRatio,
      colour: certificate.colour,
      seats: certificate.seats,
      standingPlaces: certificate.standingPlaces,
      linkedVehicleId: vehicleId,
      odometerKm: 0,
    };
    const newBuildId = builds.createBuild({ userId, ...buildValues, cover: photo });
    builds.setLinkedVehicle(newBuildId, vehicleId);
    vehicles.update(vehicleId, { linkedBuildId: newBuildId });
    await refreshPtiForPlate(certificate.numberPlate, {
      vehicleIds: [],
      buildIds: certificate.numberPlate ? [newBuildId] : [],
    });
  }

  // With no plate on the vehicle there is nothing to look up. Do not clear
  // a linked build's snapshot: the build may still carry its own plate.
  await refreshPtiForPlate(certificate.numberPlate, {
    vehicleIds: [vehicleId],
    buildIds: ownsBuild && certificate.numberPlate ? [linkedBuildId] : [],
  });

  req.flash('success', 'Vehicle added to your garage.');
  return res.redirect('/garage/ride');
});

// Update the registration certificate (tech passport) of a vehicle
router.post('/garage/ride/:id/certificate', requireAuth, verifyCsrf, async (req, res) => {
  const vehicleId = Number(req.params.id);
  const vehicle = vehicles.findById(vehicleId);
  if (!vehicle || vehicle.user_id !== req.user.id) {
    req.flash('error', 'Vehicle not found.');
    return res.redirect('/garage/ride');
  }

  const fields = certificateFields(req.body);
  const name = cleanText(req.body.title ?? '', 90);
  if (name) fields.name = name;

  // Keep the preview specs in step with the document.
  const { engine, powerHp, weightKg } = certificateSpecs(fields);
  fields.engine = engine;
  fields.powerHp = powerHp;
  fields.weightKg = weightKg;

  vehicles.update(vehicleId, fields);

  // If this vehicle is linked to a build, keep the build's copy of the
  // certificate in step with what the owner just saved.
  const linkedBuild = vehicle.linked_build_id
    ? builds.byId(vehicle.linked_build_id, req.user.id)
    : null;
  const ownsLinkedBuild = Boolean(linkedBuild && linkedBuild.user_id === req.user.id);
  if (ownsLinkedBuild) {
    builds.applyCertificate(vehicle.linked_build_id, { ...fields, powerHp, weightKg });
  }
  // Clearing the vehicle plate must not wipe a build snapshot that still
  // belongs to the build's own plate.
  await refreshPtiForPlate(fields.numberPlate, {
    vehicleIds: [vehicleId],
    buildIds: ownsLinkedBuild && fields.numberPlate ? [vehicle.linked_build_id] : [],
  });
  req.flash('success', 'Registration certificate saved.');
  return res.redirect('/garage/ride');
});

// Update the odometer from My Ride. The same reading is written to a linked
// build so both pages always show one number.
router.post('/garage/ride/:id/odometer', requireAuth, verifyCsrf, (req, res) => {
  const vehicleId = Number(req.params.id);
  const vehicle = vehicles.findById(vehicleId);
  if (!vehicle || vehicle.user_id !== req.user.id) {
    if (wantsJson(req)) return jsonError(res, req.t('Vehicle not found.'), 404);
    req.flash('error', 'Vehicle not found.');
    return res.redirect('/garage/ride');
  }

  const raw = String(req.body.mileage ?? '').replace(/[^\d]/g, '');
  const mileage = raw ? Number.parseInt(raw, 10) : null;
  if (!Number.isFinite(mileage) || mileage < 0 || mileage > 10_000_000) {
    const message = req.t('Enter the odometer reading in kilometres.');
    if (wantsJson(req)) return jsonError(res, message, 400);
    req.flash('error', message);
    return res.redirect('/garage/ride');
  }

  vehicles.update(vehicleId, { currentMileage: mileage });

  let syncedBuildId = null;
  if (vehicle.linked_build_id) {
    const linkedBuild = builds.byId(vehicle.linked_build_id, req.user.id);
    if (linkedBuild && linkedBuild.user_id === req.user.id) {
      builds.setOdometer(vehicle.linked_build_id, mileage);
      syncedBuildId = vehicle.linked_build_id;
    }
  }

  if (wantsJson(req)) {
    return jsonOk(res, { mileage, buildId: syncedBuildId });
  }
  req.flash('success', 'Odometer updated.');
  return res.redirect('/garage/ride');
});

// Set or replace the cover photo of a vehicle that is already in the garage
router.post('/garage/ride/:id/photo', requireAuth, vehicleUpload, optimizeAs('vehicle'), verifyCsrf, (req, res) => {
  const vehicleId = Number(req.params.id);
  const vehicle = vehicles.findById(vehicleId);
  if (!vehicle || vehicle.user_id !== req.user.id) {
    if (req.file) removeUpload(req.file.filename);
    req.flash('error', 'Vehicle not found.');
    return res.redirect('/garage/ride');
  }
  if (!req.file) {
    req.flash('error', 'Choose a photo to upload.');
    return res.redirect('/garage/ride');
  }
  if (mediaKind(req.file.mimetype) !== 'photo') {
    removeUpload(req.file.filename);
    req.flash('error', 'That file type is not supported.');
    return res.redirect('/garage/ride');
  }

  const oldPhoto = vehicle.photo;
  vehicles.update(vehicleId, { photo: req.file.filename });
  // The old file may be shared with a linked build or a post, so only
  // delete it when nothing else references it.
  removeUploadIfUnused(oldPhoto);

  req.flash('success', 'Cover photo updated.');
  return res.redirect('/garage/ride');
});

// Delete vehicle
router.post('/garage/ride/:id/delete', requireAuth, verifyCsrf, (req, res) => {
  const vehicleId = Number(req.params.id);
  const vehicle = vehicles.findById(vehicleId);
  if (!vehicle || vehicle.user_id !== req.user.id) {
    req.flash('error', 'Vehicle not found.');
    return res.redirect('/garage/ride');
  }
  const photo = vehicle.photo;
  const linkedBuildId = vehicle.linked_build_id;
  let deletedBuild = false;
  if (linkedBuildId) {
    const linkedBuild = builds.byId(linkedBuildId, req.user.id);
    if (linkedBuild && linkedBuild.user_id === req.user.id) {
      const ok = builds.removeBuild(linkedBuildId, req.user.id, { asModerator: false });
      if (ok) deletedBuild = true;
    }
  }

  vehicles.remove(vehicleId);
  // The photo may be shared (a linked build's cover or build media, a
  // post, ...). Only remove it from disk when nothing else still uses it
  // - otherwise deleting the car would blank out the build's photo too.
  removeUploadIfUnused(photo);
  req.flash('success', deletedBuild
    ? 'Vehicle and linked build deleted.'
    : 'Vehicle removed from your garage.');
  return res.redirect('/garage/ride');
});

// Fines page
router.get('/garage/fines', requireAuth, (req, res) => {
  const userId = req.user.id;
  const userVehicles = vehicles.listByUser(userId);
  const check = req.session.finesCheck || null;
  const checkedVehicle = check ? userVehicles.find((v) => v.id === check.vehicleId) : null;
  return res.page('garage/fines', {
    title: `Fines - ${req.app.locals.config.siteName}`,
    active: 'garage',
    vehicles: userVehicles,
    finesAvailable: isFinesAvailable(),
    checkedVehicle: checkedVehicle || null,
    result: check ? check.result || null : null,
    fineError: check ? check.error || null : null,
    finesCheckedAt: check ? check.checkedAt || null : null,
  });
});

// Look up fines for one vehicle on protocols.ge
router.post('/garage/fines/check', requireAuth, verifyCsrf, async (req, res) => {
  const userId = req.user.id;
  const userVehicles = vehicles.listByUser(userId);
  const vehicle = userVehicles.find((v) => v.id === Number(req.body.vehicle_id));
  if (!vehicle) {
    req.flash('error', 'Vehicle not found.');
    return res.redirect('/garage/fines');
  }
  const plate = normalizePlate(vehicle.number_plate);
  if (!plate) {
    req.flash('error', 'Add a number plate in My Ride before checking fines.');
    return res.redirect('/garage/fines');
  }

  const check = { vehicleId: vehicle.id, checkedAt: new Date().toISOString() };
  try {
    check.result = await lookupFines({ plate, passport: vehicle.technical_passport });
  } catch (error) {
    check.error = describeError(error.message);
  }

  // Post/redirect/get so refreshing the page does not repeat the lookup.
  req.session.finesCheck = check;
  return req.session.save(() => res.redirect('/garage/fines'));
});

// Create a bank checkout for one fine. protocols.ge's own payment dialog
// asks its API for a hosted URL using the access token that came back with
// the fine; we do the same and redirect the browser straight to the bank.
router.post('/garage/fines/:protocolId/pay', requireAuth, verifyCsrf, async (req, res) => {
  const ajax = wantsJson(req);
  const check = req.session.finesCheck;
  const userVehicles = vehicles.listByUser(req.user.id);
  const vehicle = check ? userVehicles.find((v) => v.id === check.vehicleId) : null;
  const vehicleId = Number(req.body.vehicle_id);

  if (!check || !check.result || !vehicle || vehicle.id !== vehicleId) {
    const message = 'Check the fines again before paying.';
    if (ajax) return jsonError(res, req.t(message), 409);
    req.flash('error', message);
    return res.redirect(303, '/garage/fines');
  }

  const protocolId = Number(req.params.protocolId);
  const fine = (check.result.fines || []).find((item) => Number(item.protocolId) === protocolId);
  if (!fine) {
    const message = 'That fine is no longer in your results. Check the fines again.';
    if (ajax) return jsonError(res, req.t(message), 404);
    req.flash('error', message);
    return res.redirect(303, '/garage/fines');
  }

  if (!fine.payable || !(Number(fine.amountToPay) > 0)) {
    const message = 'This fine is already paid or cannot be paid online.';
    if (ajax) return jsonError(res, req.t(message), 409);
    req.flash('error', message);
    return res.redirect(303, '/garage/fines');
  }

  const gateway = String(req.body.gateway || '').toUpperCase();
  if (gateway !== 'TBC' && gateway !== 'BOG' && gateway !== 'LIBERTY') {
    const message = 'Choose TBC, Bank of Georgia or Liberty.';
    if (ajax) return jsonError(res, req.t(message), 400);
    req.flash('error', message);
    return res.redirect(303, '/garage/fines');
  }

  try {
    // Liberty is a direct hosted page; TBC and BOG go through protocols.ge.
    const url = gateway === 'LIBERTY'
      ? libertyPaymentUrl(fine)
      : await paymentUrl({ fine, gateway });
    if (ajax) return jsonOk(res, { url });
    return res.redirect(303, url);
  } catch (error) {
    const message = describePaymentError(error.message);
    if (ajax) return jsonError(res, req.t(message), 502);
    req.flash('error', message);
    return res.redirect(303, '/garage/fines');
  }
});

export default router;
