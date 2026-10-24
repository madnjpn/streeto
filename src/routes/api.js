import express from 'express';
import fs from 'node:fs';
import * as geocode from '../lib/geocode.js';
import * as users from '../models/users.js';
import * as groups from '../models/groups.js';
import * as meetups from '../models/meetups.js';
import * as chat from '../models/chat.js';
import * as presence from '../lib/presence.js';
import * as parts from '../models/parts.js';
import * as maintenance from '../models/maintenance.js';
import * as vehicles from '../models/vehicles.js';
import * as pushSubs from '../models/push.js';
import * as devices from '../models/devices.js';
import * as friends from '../models/friends.js';
import * as notifications from '../models/notifications.js';
import config from '../config.js';
import { all } from '../db.js';
import { certificateOcr } from '../lib/ocr-server.js';
import { ocrUpload } from '../lib/uploads.js';
import { requireAuth, helpers } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { jsonOk, jsonError } from '../lib/http.js';
import { routeDistanceKm, routeGeometry, routeProfile } from '../lib/route-length.js';
import { renderView } from '../lib/views.js';
import { getClient as getRockAutoClient } from '../lib/rockauto-client.js';
import { decodeVin, readIdentifier, namesFor } from '../lib/vin.js';
import { lookupChassis, oemUrl } from '../lib/chassis.js';
import { partSources, makerCatalogue } from '../lib/part-sources.js';
import { twinsOf } from '../lib/twins.js';
import { webVersion, androidVersion } from '../lib/app-version.js';

const router = express.Router();

/* ── health probe ─────────────────────────────────────────────── */
router.get('/health', (_req, res) =>
  res.json({ ok: true, service: 'streeto', time: new Date().toISOString() }),
);

/* ── current web / Android versions (update check) ─────────────── */
router.get('/app/version', (_req, res) => {
  res.set('Cache-Control', 'no-store, max-age=0');
  res.json({
    ok: true,
    web: { version: webVersion },
    android: androidVersion(),
  });
});

/* ── street name search (proxied so no browser key is exposed) ── */
const placeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: (req) => (req.t || ((key) => key))('Too many location searches. Give it a second.'),
});

router.get('/places', placeLimiter, async (req, res) => {
  const t = req.t || ((key) => key);
  const q = String(req.query.q ?? '').trim();
  if (q.length < 3) return jsonOk(res, { places: [] });

  try {
    const places = await geocode.searchPlaces(q, { limit: Number(req.query.limit) || 6 });
    return jsonOk(res, { places });
  } catch (error) {
    console.error('[api] street search failed:', error.message);
    return res.status(502).json({
      ok: false,
      error: t('Street search is unavailable right now. You can still drop a pin on the map and type the name.'),
      places: [],
    });
  }
});

router.get('/geocode/reverse', placeLimiter, async (req, res) => {
  const t = req.t || ((key) => key);
  try {
    const place = await geocode.reverseGeocode(req.query.lat, req.query.lng);
    if (!place) return jsonError(res, t('Could not name that spot.'));
    return jsonOk(res, { place });
  } catch (error) {
    console.error('[api] reverse geocode failed:', error.message);
    return res.status(502).json({
      ok: false,
      error: t('Reverse geocoding is unavailable right now - the coordinates are still saved.'),
    });
  }
});

/* ── live search: results as the driver types ─────────────────── */
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: (req) => (req.t || ((key) => key))('Too many searches. Give it a second.'),
});

/** A price written the way the card shows it. */
function priceLabel(row) {
  if (row.price == null || row.price === '') return row.price_note || '';
  const amount = Number(row.price);
  const value = Number.isFinite(amount) ? amount.toLocaleString('en-US') : String(row.price);
  return `${value} ${row.currency || 'GEL'}`;
}

router.get('/search', searchLimiter, (req, res) => {
  const q = String(req.query.q ?? '').trim();
  const me = req.user?.id ?? 0;
  const limit = Math.min(Number(req.query.limit) || 6, 15);
  if (q.length < 2) {
    return jsonOk(res, { ok: true, people: [], groups: [], meetups: [], builds: [], parts: [], services: [] });
  }

  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;

  const people = users.search(q, { excludeId: me, limit }).map((row) => ({
    username: row.username,
    displayName: row.display_name || row.username,
    car: row.car,
    city: row.city,
    avatar: row.avatar,
  }));

  const groupHits = groups.directory({ q, userId: me, limit }).map((row) => ({
    slug: row.slug,
    name: row.name,
    privacy: row.privacy,
    members: row.member_count,
  }));

  const meetupHits = meetups.list({ scope: 'upcoming', q, viewerId: me, limit }).map((row) => ({
    id: row.id,
    title: row.title,
    placeName: row.place_name,
    startsAt: row.starts_at,
  }));

  const buildHits = all(
    `SELECT b.id, b.title, b.make, b.model, b.cover, u.username
       FROM builds b JOIN users u ON u.id = b.user_id
      WHERE b.visibility = 'public'
        AND (b.title LIKE :like ESCAPE '\\' OR b.make LIKE :like ESCAPE '\\'
             OR b.model LIKE :like ESCAPE '\\' OR u.username LIKE :like ESCAPE '\\')
      ORDER BY b.created_at DESC
      LIMIT :limit`,
    { like, limit },
  );

  const partHits = parts.feed({ scope: 'all', q, limit }).map((row) => ({
    id: row.id,
    title: row.title,
    priceLabel: priceLabel(row),
    username: row.username,
    cover: row.cover,
  }));

  const serviceHits = maintenance.feed({ scope: 'all', q, limit }).map((row) => ({
    id: row.id,
    title: row.title,
    placeName: row.place_name,
    username: row.username,
    cover: row.cover,
  }));

  return jsonOk(res, {
    ok: true,
    people,
    groups: groupHits,
    meetups: meetupHits,
    builds: buildHits,
    parts: partHits,
    services: serviceHits,
  });
});

/* ── the pulse: unread badges in the nav ───────────────────────── */
router.get('/pulse', requireAuth, (req, res) => {
  const me = req.user.id;
  const global = chat.globalConversation(me);
  const dmUnread = chat.listConversations(me).reduce(
    (total, row) => total + (row.muted ? 0 : (row.unread || 0)),
    0,
  );
  return jsonOk(res, {
    ok: true,
    messages: ((global && !global.muted) ? (global.unread || 0) : 0) + dmUnread,
    notifications: notifications.unreadCount(me),
    requests: friends.incomingRequests(me).length,
  });
});

/* ── route distance for touge meetups ─────────────────────────── */
const routeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: (req) => (req.t || ((key) => key))('Too many route requests. Give it a second.'),
});

router.get('/route/distance', routeLimiter, async (req, res) => {
  const t = req.t || ((key) => key);
  const from = String(req.query.from ?? '').trim();
  const to = String(req.query.to ?? '').trim();

  function parsePoint(s) {
    const [lat, lng] = s.split(',').map((v) => Number(v));
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  const start = parsePoint(from);
  const end = parsePoint(to);
  if (!start || !end) return jsonError(res, t('Two points are needed.'), 400);

  try {
    const result = await routeDistanceKm(start, end);
    return jsonOk(res, { ok: true, km: result.km, source: result.source });
  } catch (error) {
    console.error('[api] route distance failed:', error.message);
    return res.status(502).json({
      ok: false,
      error: t('Routing engine is unavailable right now.'),
    });
  }
});

router.get('/route/geometry', routeLimiter, async (req, res) => {
  const t = req.t || ((key) => key);
  const from = String(req.query.from ?? '').trim();
  const to = String(req.query.to ?? '').trim();

  function parsePoint(s) {
    const [lat, lng] = s.split(',').map((v) => Number(v));
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  const start = parsePoint(from);
  const end = parsePoint(to);
  if (!start || !end) return jsonError(res, t('Two points are needed.'), 400);

  const result = await routeGeometry(start, end);
  return jsonOk(res, { ok: true, coordinates: result.coordinates, km: result.km, source: result.source });
});

/** The route with its elevation profile (heights, climb and descent). */
router.get('/route/profile', routeLimiter, async (req, res) => {
  const t = req.t || ((key) => key);
  const from = String(req.query.from ?? '').trim();
  const to = String(req.query.to ?? '').trim();

  function parsePoint(s) {
    const [lat, lng] = s.split(',').map((v) => Number(v));
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  const start = parsePoint(from);
  const end = parsePoint(to);
  if (!start || !end) return jsonError(res, t('Two points are needed.'), 400);

  const result = await routeProfile(start, end);
  return jsonOk(res, {
    ok: true,
    coordinates: result.coordinates,
    elevations: result.elevations,
    km: result.km,
    gain: result.gain,
    loss: result.loss,
    min: result.min,
    max: result.max,
    source: result.source,
  });
});

/* ── the groups a driver can share into ────────────────────────── */
router.get('/groups/mine', requireAuth, (req, res) => {
  const list = groups.myGroups(req.user.id)
    .filter((group) => group.status === 'active')
    .map((group) => ({
      slug: group.slug,
      name: group.name,
      avatar: group.avatar || null,
    }));
  return jsonOk(res, { groups: list });
});

/* ── weather for a meetup's date ───────────────────────────────── */
/* A forecast when the date is near, otherwise the same day from a
   recent year as a "typical weather" hint. */
const weatherLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: (req) => (req.t || ((key) => key))('Too many weather requests. Give it a second.'),
});

const weatherCache = new Map();

router.get('/weather', weatherLimiter, async (req, res) => {
  const t = req.t || ((key) => key);
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const raw = String(req.query.at ?? '').trim();
  const date = /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : '';

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 || !date) {
    return jsonError(res, t('A date and a spot are needed for the weather.'), 400);
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const wanted = new Date(`${date}T00:00:00Z`);
  const days = Math.round((wanted.getTime() - today.getTime()) / 86400000);

  // Only a real forecast is shown. The public forecast reaches about
  // 16 days ahead; beyond that there is nothing truthful to say.
  if (days < 0 || days > 16) {
    return jsonOk(res, { ok: false, reason: 'out_of_range', date });
  }

  const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)},${date}`;
  const cached = weatherCache.get(cacheKey);
  if (cached && Date.now() - cached.at < (cached.data.ok ? 60 * 60 * 1000 : 5 * 60 * 1000)) {
    return jsonOk(res, cached.data);
  }

  const daily = 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code';
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}`
    + `&start_date=${date}&end_date=${date}&daily=${daily}&timezone=auto`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const upstream = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!upstream.ok) throw new Error(`weather error ${upstream.status}`);
    const payload = await upstream.json();
    const day = payload.daily;
    if (!day || !Array.isArray(day.time) || !day.time.length) throw new Error('no weather');

    const data = {
      ok: true,
      kind: 'forecast',
      date,
      max: Number.isFinite(day.temperature_2m_max?.[0]) ? Math.round(day.temperature_2m_max[0]) : null,
      min: Number.isFinite(day.temperature_2m_min?.[0]) ? Math.round(day.temperature_2m_min[0]) : null,
      code: Number.isFinite(day.weather_code?.[0]) ? day.weather_code[0] : null,
      precip: Number.isFinite(day.precipitation_probability_max?.[0]) ? Math.round(day.precipitation_probability_max[0]) : null,
      precipUnit: '%',
    };
    weatherCache.set(cacheKey, { at: Date.now(), data });
    return jsonOk(res, data);
  } catch (error) {
    console.error('[api] weather failed:', error.message);
    const data = { ok: false, reason: 'unavailable', date };
    weatherCache.set(cacheKey, { at: Date.now(), data });
    return jsonOk(res, data);
  } finally {
    clearTimeout(timer);
  }
});

/* ── the parts catalogue ───────────────────────────────────────── */
/* Every call here goes out to another site, so they are few and far
   between: the limiter keeps the page from hammering the catalogue. */
const partsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: (req) => (req.t || ((key) => key))('Too many searches. Give it a minute.'),
});

/** The places a number can be looked up - answered straight away. */
router.get('/parts/sources', partsLimiter, (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 80);
  return jsonOk(res, { q, sources: partSources(q) });
});

/** Parts by part number, cross reference or keyword. */
router.get('/parts/search', partsLimiter, async (req, res) => {
  const t = req.t || ((key) => key);
  const q = String(req.query.q ?? '').trim().slice(0, 80);
  if (!q) return jsonOk(res, { q, parts: [], sources: [] });
  const rockauto = await getRockAutoClient();
  try {
    const parts = await rockauto.searchParts(q);
    return jsonOk(res, { q, parts, sources: partSources(q) });
  } catch (error) {
    return res.status(200).json({
      ok: true,
      q,
      parts: [],
      sources: partSources(q),
      warning: t('The parts catalogue is not answering right now - use the links below.'),
    });
  }
});

/** The makes, years, models and engines of the catalogue. */
router.get('/parts/tree', partsLimiter, async (req, res) => {
  const t = req.t || ((key) => key);
  const make = String(req.query.make ?? '').trim().toUpperCase();
  const year = String(req.query.year ?? '').trim();
  const model = String(req.query.model ?? '').trim().toUpperCase();
  const rockauto = await getRockAutoClient();
  try {
    if (!make) return jsonOk(res, { makes: await rockauto.makes() });
    if (!year) return jsonOk(res, { years: await rockauto.years(make) });
    if (!model) return jsonOk(res, { models: await rockauto.models(make, year) });
    const engines = await rockauto.engines(make, year, model);
    return jsonOk(res, { engines });
  } catch (error) {
    console.error('[api] parts tree failed:', error.message);
    return res.status(200).json({
      ok: true,
      warning: t('The parts catalogue is not answering right now.'),
    });
  }
});

/** The catalogue of one car: groups, then part types, then the parts. */
router.get('/parts/vehicle', partsLimiter, async (req, res) => {
  const t = req.t || ((key) => key);
  const make = String(req.query.make ?? '').trim().toUpperCase();
  const year = String(req.query.year ?? '').trim();
  const model = String(req.query.model ?? '').trim().toUpperCase();
  const engine = String(req.query.engine ?? '').trim();
  const carcode = String(req.query.carcode ?? '').trim();
  const group = String(req.query.group ?? '').trim();
  const parttype = String(req.query.parttype ?? '').trim();
  if (!make || !year || !model) return jsonError(res, t('Make, year and model are required.'), 400);

  const rockauto = await getRockAutoClient();
  const vehicle = { make, year, model, engine, carcode };
  try {
    if (group && parttype) {
      const parts = await rockauto.partsForVehicle({ ...vehicle, group, parttype });
      return jsonOk(res, { parts });
    }
    if (group) {
      const types = await rockauto.partTypes({ ...vehicle, group });
      // The id is what the catalogue understands; the name is only for
      // the driver, so it can be Georgian.
      return jsonOk(res, { types: types.map((row) => ({ ...row, name: t(row.name) })) });
    }
    const groups = await rockauto.groups(make, year, model, engine, carcode);
    return jsonOk(res, { groups: groups.map((row) => ({ ...row, name: t(row.name) })) });
  } catch (error) {
    console.error('[api] parts/vehicle failed:', error.message);
    return res.status(200).json({
      ok: true,
      groups: [],
      types: [],
      parts: [],
      warning: t('The parts catalogue is not answering right now.'),
    });
  }
});

/** The cars in the driver's garage, ready for the part search. */
router.get('/parts/garage', partsLimiter, requireAuth, (req, res) => {
  const cars = vehicles.listByUser(req.user.id).map((car) => ({
    id: car.id,
    name: car.name,
    make: car.make,
    model: car.model,
    year: car.year,
    engine: car.engine,
    plate: car.number_plate,
    passport: car.technical_passport,
    vin: car.vin,
    visibility: car.visibility,
  }));
  return jsonOk(res, { ok: true, vehicles: cars });
});

/**
 * A VIN, a chassis code or a frame number. All three name a car; the
 * first is read by the register, the other two by the chassis table.
 */
router.get('/parts/vin', partsLimiter, async (req, res) => {
  const t = req.t || ((key) => key);
  const raw = String(req.query.vin ?? '').trim();
  if (!raw) return jsonError(res, t('Type a VIN, a chassis code or a frame number.'), 400);

  const read = readIdentifier(raw);
  if (read.kind === 'invalid') {
    return jsonOk(res, {
      ok: false,
      kind: 'invalid',
      error: read.reason || t('That is neither a VIN nor a chassis code.'),
    });
  }

  if (read.kind === 'vin') {
    let car = null;
    try {
      car = await decodeVin(read.value);
    } catch {
      car = { vin: read.value, partial: true, reason: 'unavailable' };
    }
    const names = namesFor(car || {});
    const twins = car?.make && car?.model ? twinsOf(car.make, car.model) : [];
    return jsonOk(res, { ok: true, kind: 'vin', vin: read.value, checkDigit: read.checkDigit, car, names, twins });
  }

  // A chassis code or a frame number: shorter than a VIN, and read from
  // the chassis table rather than from the register.
  const code = read.kind === 'frame' ? read.chassis : read.value;
  const known = lookupChassis(code);
  const car = known
    ? { make: known.make, model: known.model, years: known.years, note: known.note, code: known.code }
    : null;
  const twins = car ? twinsOf(car.make, car.model) : [];

  return jsonOk(res, {
    ok: true,
    kind: read.kind,
    code,
    serial: read.serial || null,
    full: read.full || read.value,
    normalized: read.normalized,
    car,
    twins,
    oemUrl: oemUrl(code),
  });
});

/* ── chat dock ─────────────────────────────────────────────────── */
/** One row of the dock: the global channel, then every direct chat. */
function dockConversation(row, me) {
  const isGlobal = row.kind === 'global';
  return {
    id: row.id,
    kind: row.kind || 'dm',
    title: isGlobal
      ? (row.name || 'Global channel')
      : (row.other_display_name || row.other_username || 'Driver'),
    topic: row.topic || null,
    memberCount: row.member_count ?? null,
    username: row.other_username || null,
    otherId: row.other_id || null,
    avatar: row.other_avatar || null,
    online: row.other_id ? presence.isOnline(row.other_id) : false,
    lastBody: row.last_body ?? null,
    lastMediaType: row.last_media_type ?? null,
    lastShareType: row.last_share_type ?? null,
    lastShareTitle: row.last_share_title ?? null,
    lastAt: row.last_at ?? null,
    lastMine: row.last_sender_id === me,
    unread: row.unread || 0,
    muted: Boolean(row.muted),
  };
}

router.get('/chat/dock', requireAuth, (req, res) => {
  const me = req.user.id;
  const conversations = [];

  const global = chat.globalConversation(me);
  if (global) conversations.push(dockConversation(global, me));
  for (const row of chat.listConversations(me)) {
    conversations.push(dockConversation(row, me));
  }

  const unread = conversations.reduce((total, row) => total + (row.muted ? 0 : (row.unread || 0)), 0);

  // A thread that was just started has no messages yet, so it is not in
  // the list - the dock asks for it by id when it opens such a link.
  let conversation = null;
  const wanted = Number(req.query.id);
  if (Number.isInteger(wanted) && wanted > 0 && chat.isMember(wanted, me)) {
    const row = chat.summary(wanted, me);
    if (row) conversation = dockConversation(row, me);
  }

  return jsonOk(res, { ok: true, unread, conversations, conversation });
});

/* ── web push ──────────────────────────────────────────────────── */
router.get('/push/vapid-public-key', (_req, res) =>
  jsonOk(res, { publicKey: config.vapidPublicKey || '' }),
);

router.post('/push/subscribe', requireAuth, (req, res) => {
  const subscription = req.body?.subscription || req.body || {};
  const endpoint = subscription.endpoint;
  if (!endpoint) return jsonError(res, 'No subscription.', 400);
  const keys = subscription.keys || {};
  pushSubs.subscribe(req.user.id, endpoint, keys.p256dh || null, keys.auth || null);
  return jsonOk(res, { ok: true });
});

router.post('/push/unsubscribe', (req, res) => {
  const endpoint = req.body?.subscription?.endpoint || req.body?.endpoint;
  if (endpoint) pushSubs.unsubscribe(endpoint);
  return jsonOk(res, { ok: true });
});

/* Android FCM installation tokens. The native shell posts its token after
   login; the server fans notifications out through FCM as well as Web Push. */
router.post('/push/device', requireAuth, (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!token || token.length > 4096) return jsonError(res, 'No device token.', 400);
  devices.upsert(req.user.id, token, 'android');
  return jsonOk(res, { ok: true });
});

router.post('/push/device/remove', requireAuth, (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (token) devices.remove(token);
  return jsonOk(res, { ok: true });
});

/* ── server-side certificate OCR (Google Gemini) ─────────── */
router.post('/ocr/certificate', requireAuth, ocrUpload, async (req, res) => {
  if (!req.file) return jsonError(res, 'No image uploaded.', 400);

  const cleanup = () => {
    if (req.file && req.file.path) {
      fs.rm(req.file.path, { force: true }, () => {});
    }
  };

  let buffer;
  try {
    buffer = req.file.buffer || fs.readFileSync(req.file.path);
  } catch (err) {
    cleanup();
    return jsonError(res, 'Empty image.', 400);
  }
  if (!buffer || !buffer.length) {
    cleanup();
    return jsonError(res, 'Empty image.', 400);
  }

  if (!config.geminiApiKey) {
    cleanup();
    return jsonError(res, 'OCR not configured. Set GEMINI_API_KEY.', 500);
  }

  try {
    const side = String(req.body?.side || '').toLowerCase() === 'back' ? 'back' : 'front';
    const result = await certificateOcr(buffer, { filename: req.file.originalname, side });
    const fields = result.fields || {};
    cleanup();
    if (!Object.keys(fields).length) {
      return jsonOk(res, { text: result.text || '', fields: {}, provider: 'gemini', error: 'No fields detected' });
    }
    return jsonOk(res, {
      text: result.text || '',
      fields,
      provider: 'gemini',
      model: result.model,
    });
  } catch (err) {
    console.error('[ocr] gemini failed:', err.message);
    cleanup();
    if (/quota|rate limit|HTTP 429/i.test(err.message)) {
      return jsonError(res, 'The scanner is busy right now. Please try again in a minute.', 429);
    }
    if (/GEMINI_API_KEY|API key not valid|PERMISSION_DENIED/i.test(err.message)) {
      return jsonError(res, 'OCR failed. Check GEMINI_API_KEY and network.', 500);
    }
    return jsonError(res, 'OCR failed. Check GEMINI_API_KEY and network.', 500);
  }
});

export default router;