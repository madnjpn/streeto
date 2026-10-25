import express from 'express';
import config from '../config.js';
import { all } from '../db.js';
import * as underground from '../models/underground.js';
import * as vehicles from '../models/vehicles.js';
import * as notifications from '../models/notifications.js';
import { requireAuth } from '../middleware/auth.js';
import { verifyCsrf } from '../middleware/csrf.js';
import { cleanText, checkCoords, checkZoom } from '../lib/validate.js';
import { routeDistanceKm } from '../lib/route-length.js';
import { wantsJson, jsonOk, jsonError } from '../lib/http.js';
import { vehicleUpload, optimizeAs, mediaKind, removeUpload } from '../lib/uploads.js';
import { sendMail } from '../lib/mail.js';
import { translate } from '../lib/i18n.js';
import { undergroundSummaryEmail } from '../lib/mail-templates.js';

const router = express.Router();
const TYPES = ['drag', 'drift', 'touge'];
const ARRIVAL_RADIUS_M = 350;

const parseStart = (value) => {
  const date = new Date(String(value ?? '').trim());
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const coordsOrNull = (lat, lng) => {
  const pair = checkCoords(lat, lng);
  return pair.ok ? pair : null;
};

const haversineKm = (a, b) => {
  const rad = (n) => (n * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
};

const round = (n, digits = 1) => {
  const f = 10 ** digits;
  return Number.isFinite(Number(n)) ? Math.round(Number(n) * f) / f : 0;
};

/** Keep a submitted track small and numeric; the server calculates metrics. */
function sanitizeTrack(raw) {
  if (!Array.isArray(raw)) return [];
  const points = [];
  for (const point of raw.slice(-5000)) {
    const lat = Number(point?.lat);
    const lng = Number(point?.lng);
    const t = Number(point?.t);
    const speed = Number(point?.speed);
    if (![lat, lng, t].every(Number.isFinite)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    points.push({
      lat: round(lat, 6),
      lng: round(lng, 6),
      t: Math.round(t),
      speed: Number.isFinite(speed) ? Math.max(0, round(speed, 1)) : 0,
    });
  }
  return points.sort((a, b) => a.t - b.t);
}

function trackMetrics(points) {
  if (points.length < 2) {
    return { topSpeed: 0, avgSpeed: 0, distanceKm: 0, acceleration: 0, durationS: 0 };
  }
  let distance = 0;
  let top = 0;
  let accel = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const km = haversineKm(a, b);
    // Ignore GPS jumps; > 1.5 km between two samples is not a road.
    if (km < 1.5) distance += km;
    top = Math.max(top, Number(a.speed) || 0, Number(b.speed) || 0);
    const seconds = Math.max(0.001, (b.t - a.t) / 1000);
    const ms = ((Number(b.speed) || 0) - (Number(a.speed) || 0)) / 3.6;
    if (seconds > 0.4) accel = Math.max(accel, ms / seconds);
  }
  const durationS = Math.max(1, Math.round((points[points.length - 1].t - points[0].t) / 1000));
  return {
    topSpeed: round(top),
    avgSpeed: round((distance / durationS) * 3600),
    distanceKm: round(distance, 2),
    acceleration: round(accel, 2),
    durationS,
  };
}

const canSeeEvent = (event, userId) =>
  Boolean(event && userId && (event.host_id === userId || underground.isApproved(event.id, userId)));

function parseRunTrack(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* ── list / my underground ───────────────────────────────────────── */
router.get('/underground', requireAuth, (req, res) => {
  const scope = req.query.scope === 'mine' ? 'mine' : 'events';
  const events = scope === 'events' ? underground.listEvents() : [];
  const runs = scope === 'mine' ? underground.runsForUser(req.user.id) : [];
  return res.page('underground/index', {
    title: `Underground - ${req.app.locals.config.siteName}`,
    active: 'underground',
    bodyClass: 'page-underground',
    scope,
    pageScripts: [`/assets/${res.locals.assetStamp}/js/underground.js`],
    events: events.map((event) => ({
      ...event,
      myRequest: underground.requestFor(event.id, req.user.id),
    })),
    runs: runs.map((run) => ({ ...run, track: parseRunTrack(run.track_json) })),
  });
});

/* ── host a night ────────────────────────────────────────────────── */
router.get('/underground/new', requireAuth, (req, res) => {
  const userVehicles = vehicles.listByUser(req.user.id);
  return res.page('underground/new', {
    title: `Host Underground - ${req.app.locals.config.siteName}`,
    active: 'underground',
    bodyClass: 'page-underground',
    errors: {},
    values: {
      title: '',
      description: '',
      type: 'drag',
      starts_at: '',
      lat: '',
      lng: '',
      zoom: 14,
      place_name: '',
      route_start_lat: '',
      route_start_lng: '',
      route_start_name: '',
      route_end_lat: '',
      route_end_lng: '',
      route_end_name: '',
    },
    userVehicles,
    types: TYPES,
  });
});

router.post('/underground/new', requireAuth, verifyCsrf, async (req, res) => {
  const title = cleanText(req.body.title ?? '', 100);
  const description = cleanText(req.body.description ?? '', 2000);
  const type = TYPES.includes(req.body.type) ? req.body.type : 'drag';
  const startsAt = parseStart(req.body.starts_at);
  const meet = coordsOrNull(req.body.lat, req.body.lng);
  const zoom = meet ? checkZoom(req.body.zoom) : null;
  const placeName = cleanText(req.body.place_name ?? '', 160) || null;
  const routeStart = coordsOrNull(req.body.route_start_lat, req.body.route_start_lng);
  const routeEnd = coordsOrNull(req.body.route_end_lat, req.body.route_end_lng);
  const routeStartName = cleanText(req.body.route_start_name ?? '', 160) || null;
  const routeEndName = cleanText(req.body.route_end_name ?? '', 160) || null;
  const values = {
    title,
    description,
    type,
    starts_at: req.body.starts_at ?? '',
    lat: req.body.lat ?? '',
    lng: req.body.lng ?? '',
    zoom: req.body.zoom ?? 14,
    place_name: req.body.place_name ?? '',
    route_start_lat: req.body.route_start_lat ?? '',
    route_start_lng: req.body.route_start_lng ?? '',
    route_start_name: routeStartName || '',
    route_end_lat: req.body.route_end_lat ?? '',
    route_end_lng: req.body.route_end_lng ?? '',
    route_end_name: routeEndName || '',
  };
  const errors = {};
  if (title.length < 3) errors.title = 'Give the night a title.';
  if (!startsAt) errors.starts_at = 'Pick a date and time.';
  if (!meet) errors.place_name = 'Pin the meeting spot on the map.';
  if (type === 'touge' && (!routeStart || !routeEnd)) {
    errors.route = 'Pick the start (A) and finish (B) on the map.';
  }

  if (Object.keys(errors).length) {
    return res.status(400).page('underground/new', {
      title: `Host Underground - ${req.app.locals.config.siteName}`,
      active: 'underground',
      bodyClass: 'page-underground',
      errors,
      values,
      userVehicles: vehicles.listByUser(req.user.id),
      types: TYPES,
    });
  }

  let distance = null;
  if (type === 'touge' && routeStart && routeEnd) {
    distance = (await routeDistanceKm(routeStart, routeEnd)).km;
  }

  const me = req.user;
  const myVehicles = vehicles.listByUser(req.user.id);
  const car = me.car || myVehicles[0]?.name || null;
  const photo = myVehicles[0]?.photo || null;
  const event = underground.createEvent({
    hostId: req.user.id,
    title,
    description: description || null,
    type,
    startsAt,
    meetName: placeName,
    meetLat: meet.lat,
    meetLng: meet.lng,
    zoom,
    routeStartLat: routeStart?.lat ?? null,
    routeStartLng: routeStart?.lng ?? null,
    routeStartName,
    routeEndLat: routeEnd?.lat ?? null,
    routeEndLng: routeEnd?.lng ?? null,
    routeEndName,
    routeDistanceKm: distance,
    hostCar: car,
    hostPhoto: photo,
  });

  // Underground nights are announced to the network, but the host stays
  // anonymous: actorId is deliberately null.
  for (const member of all('SELECT id FROM users WHERE id <> ?', req.user.id)) {
    notifications.notify({
      userId: member.id,
      type: 'underground_event',
      entityId: event.id,
      url: `/underground/${event.id}`,
      text: 'A new Underground night is live: {name}|' + title,
      push: true,
      category: 'meetups',
    });
  }
  req.flash('success', 'Underground night created. Approve your drivers before the map opens.');
  return res.redirect(`/underground/${event.id}`);
});

/* ── one night ───────────────────────────────────────────────────── */
router.get('/underground/:id', requireAuth, (req, res, next) => {
  const event = underground.byId(Number(req.params.id));
  if (!event) return next();
  const isHost = event.host_id === req.user.id;
  const approved = isHost || underground.isApproved(event.id, req.user.id);
  const myRequest = underground.requestFor(event.id, req.user.id);
  const myRun = underground.runFor(event.id, req.user.id);
  const canRace = approved && event.status === 'open';
  return res.page('underground/show', {
    title: `${event.title} - Underground`,
    active: 'underground',
    pageScripts: [`/assets/${res.locals.assetStamp}/js/underground.js`],
    bodyClass: 'page-underground',
    event,
    isHost,
    approved,
    canRace,
    myRequest,
    myRun: myRun ? { ...myRun, track: parseRunTrack(myRun.track_json) } : null,
    pending: isHost ? underground.pendingRequests(event.id) : [],
    participants: approved ? underground.participants(event.id) : [],
    myVehicles: approved ? [] : vehicles.listByUser(req.user.id),
    arrivalRadiusM: ARRIVAL_RADIUS_M,
  });
});

/* ── ask to join ─────────────────────────────────────────────────── */
router.post(
  '/underground/:id/join',
  requireAuth,
  vehicleUpload,
  optimizeAs('vehicle'),
  verifyCsrf,
  (req, res, next) => {
    const event = underground.byId(Number(req.params.id));
    if (!event) return next();
    if (event.host_id === req.user.id) return res.redirect(`/underground/${event.id}`);

    const ownVehicles = vehicles.listByUser(req.user.id);
    const vehicle = ownVehicles.find((row) => row.id === Number(req.body.vehicle_id));
    const manual = cleanText(req.body.car_model ?? '', 120);
    const carModel = vehicle?.name || manual;
    if (!carModel) {
      if (req.file) removeUpload(req.file.filename);
      req.flash('error', 'Choose a car from My Ride or type the car/bike you are bringing.');
      return res.redirect(`/underground/${event.id}`);
    }
    let photo = vehicle?.photo || null;
    if (req.file) {
      if (mediaKind(req.file.mimetype) !== 'photo') {
        removeUpload(req.file.filename);
        req.flash('error', 'The car photo must be an image.');
        return res.redirect(`/underground/${event.id}`);
      }
      photo = req.file.filename;
    }

    const before = underground.requestFor(event.id, req.user.id);
    if (before?.status === 'approved') return res.redirect(`/underground/${event.id}`);
    underground.requestJoin(event.id, req.user.id, { carModel, carPhoto: photo });
    notifications.notify({
      userId: event.host_id,
      actorId: req.user.id,
      type: 'underground_request',
      entityId: event.id,
      url: `/underground/${event.id}#requests`,
      text: 'asked to join your Underground night: {name}|' + event.title,
      category: 'meetups',
    });
    req.flash('success', 'Request sent. The host has your car details and will decide.');
    return res.redirect(`/underground/${event.id}`);
  },
);

/* ── host decisions + finish ─────────────────────────────────────── */
router.post('/underground/:id/requests/:userId/approve', requireAuth, verifyCsrf, (req, res, next) => {
  const event = underground.byId(Number(req.params.id));
  if (!event) return next();
  if (event.host_id !== req.user.id) {
    req.flash('error', 'Only the host can approve drivers.');
    return res.redirect(`/underground/${event.id}`);
  }
  underground.decideRequest(event.id, Number(req.params.userId), 'approved');
  notifications.notify({
    userId: Number(req.params.userId),
    type: 'underground_approved',
    entityId: event.id,
    url: `/underground/${event.id}`,
    text: 'Your Underground request was approved: {name}|' + event.title,
    category: 'meetups',
  });
  req.flash('success', 'Driver approved. The map is now open for them.');
  return res.redirect(`/underground/${event.id}#requests`);
});

router.post('/underground/:id/requests/:userId/reject', requireAuth, verifyCsrf, (req, res, next) => {
  const event = underground.byId(Number(req.params.id));
  if (!event) return next();
  if (event.host_id !== req.user.id) {
    req.flash('error', 'Only the host can reject drivers.');
    return res.redirect(`/underground/${event.id}`);
  }
  underground.decideRequest(event.id, Number(req.params.userId), 'rejected');
  notifications.notify({
    userId: Number(req.params.userId),
    type: 'underground_rejected',
    entityId: event.id,
    url: `/underground/${event.id}`,
    text: 'Your Underground request was rejected: {name}|' + event.title,
    category: 'meetups',
  });
  req.flash('success', 'Request rejected.');
  return res.redirect(`/underground/${event.id}#requests`);
});

router.post('/underground/:id/finish', requireAuth, verifyCsrf, async (req, res, next) => {
  const event = underground.byId(Number(req.params.id));
  if (!event) return next();
  if (event.host_id !== req.user.id) {
    req.flash('error', 'Only the host can finish this night.');
    return res.redirect(`/underground/${event.id}`);
  }
  if (event.status === 'finished') return res.redirect(`/underground/${event.id}`);
  underground.finishEvent(event.id);

  const people = underground.participants(event.id);
  const runs = underground.runsForEvent(event.id);
  const byUser = new Map(runs.map((run) => [run.user_id, run]));
  const siteUrl = config.publicUrl || '';
  await Promise.allSettled(people.map(async (person) => {
    if (!person.email) return;
    const lang = person.language || 'en';
    const t = (key, vars) => translate(lang, key, vars);
    const mail = undergroundSummaryEmail({
      t,
      user: person,
      event,
      run: byUser.get(person.user_id) || null,
      siteName: config.siteName,
      siteUrl,
      logoUrl: siteUrl ? `${siteUrl}/websitelogo.png` : '/websitelogo.png',
    });
    await sendMail({ to: person.email, subject: mail.subject, html: mail.html, text: mail.text });
    underground.markSummarySent(event.id, person.user_id);
  }));

  req.flash('success', 'Night finished. Every approved driver gets their summary by email.');
  return res.redirect(`/underground/${event.id}`);
});

/* ── live APIs ───────────────────────────────────────────────────── */
router.get('/api/underground/:id/live', requireAuth, (req, res, next) => {
  const event = underground.byId(Number(req.params.id));
  if (!event) return next();
  if (!canSeeEvent(event, req.user.id)) return jsonError(res, 'Only approved drivers can see the live map.', 403);
  const positions = underground.livePositions(event.id).map((row) => {
    if (row.user_id === event.host_id) {
      return { ...row, username: null, display_name: 'Underground host', avatar: null, is_host: true };
    }
    return row;
  });
  return jsonOk(res, {
    participants: positions,
    event: {
      id: event.id,
      type: event.type,
      status: event.status,
      meet_lat: event.meet_lat,
      meet_lng: event.meet_lng,
    },
  });
});

router.post('/api/underground/:id/position', requireAuth, verifyCsrf, (req, res, next) => {
  const event = underground.byId(Number(req.params.id));
  if (!event) return next();
  if (!underground.isApproved(event.id, req.user.id)) {
    return jsonError(res, 'Only approved drivers can share their position.', 403);
  }
  if (event.status !== 'open') return jsonError(res, 'This night is already finished.', 409);
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return jsonError(res, 'Invalid position.');
  }
  const speed = Number(req.body.speed);
  const heading = Number(req.body.heading);
  underground.savePosition(event.id, req.user.id, {
    lat,
    lng,
    speed: Number.isFinite(speed) ? Math.max(0, Math.min(400, speed)) : null,
    heading: Number.isFinite(heading) ? heading : null,
  });
  return jsonOk(res);
});

router.post('/api/underground/:id/run', requireAuth, verifyCsrf, (req, res, next) => {
  const event = underground.byId(Number(req.params.id));
  if (!event) return next();
  if (!underground.isApproved(event.id, req.user.id)) {
    return jsonError(res, 'Only approved drivers can record a run.', 403);
  }
  if (event.status !== 'open') return jsonError(res, 'This night is already finished.', 409);
  const track = sanitizeTrack(req.body.track);
  if (track.length < 2) return jsonError(res, 'Not enough GPS points were recorded. Stay a little longer and try again.');
  const metrics = trackMetrics(track);
  const startedAt = new Date(track[0].t).toISOString();
  const finishedAt = new Date(track[track.length - 1].t).toISOString();
  const run = underground.saveRun({
    eventId: event.id,
    userId: req.user.id,
    mode: event.type,
    startedAt,
    finishedAt,
    ...metrics,
    track,
  });
  return jsonOk(res, { run: { ...run, track } });
});

export default router;
