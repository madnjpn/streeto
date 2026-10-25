/* Underground live map, race mode and the virtual lock screen. */
import { t } from './i18n.js';
import { MAP_STYLE } from './map-style.js';

const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
const hasMap = typeof window.maplibregl !== 'undefined';

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const haversineM = (a, b) => {
  const rad = (n) => (n * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
};

const initials = (value) => String(value || 'U').trim().slice(0, 2).toUpperCase();

const avatarUrl = (path, base) => {
  if (!path) return '';
  if (/^https?:\/\//i.test(path) || path.startsWith('/')) return path;
  return `${base || '/uploads'}/${path}`;
};

function lineFeature(track) {
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: track.map((point) => Array.isArray(point)
        ? [Number(point[0]), Number(point[1])]
        : [Number(point.lng), Number(point.lat)]),
    },
    properties: {},
  };
}

/** Ask STREETO's routing proxy for the real road line between A and B. */
async function roadRoute(map, start, end) {
  if (!map || start?.lat == null || end?.lat == null) return null;
  try {
    const response = await fetch(
      // The API takes lat,lng, while GeoJSON takes lng,lat.
      '/api/route/profile?from=' + start.lat + ',' + start.lng + '&to=' + end.lat + ',' + end.lng,
      { credentials: 'same-origin', headers: { 'x-requested-with': 'fetch' } },
    );
    if (!response.ok) return null;
    const data = await response.json();
    if (!data.ok || !Array.isArray(data.coordinates) || data.coordinates.length < 2) return null;
    routeLayer(map, data.coordinates);
    return data.coordinates;
  } catch {
    return null;
  }
}

function routeLayer(map, track) {
  if (!map || !Array.isArray(track) || track.length < 2) return;
  const sourceId = 'ug-route';
  const data = lineFeature(track);
  if (map.getSource(sourceId)) {
    map.getSource(sourceId).setData(data);
  } else {
    map.addSource(sourceId, { type: 'geojson', data });
    map.addLayer({
      id: 'ug-route-glow',
      type: 'line',
      source: sourceId,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ff3b4d', 'line-width': 10, 'line-opacity': 0.22 },
    });
    map.addLayer({
      id: 'ug-route-line',
      type: 'line',
      source: sourceId,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ff3b4d', 'line-width': 3.5, 'line-opacity': 0.95 },
    });
  }
  const bounds = new window.maplibregl.LngLatBounds();
  data.geometry.coordinates.forEach((c) => bounds.extend(c));
  map.fitBounds(bounds, { padding: 42, duration: 0, maxZoom: 16 });
}

function buildMap(el, { center, zoom = 14, pitch = 0, bearing = 0 }) {
  const map = new window.maplibregl.Map({
    container: el,
    style: MAP_STYLE,
    center,
    zoom,
    pitch,
    bearing,
    attributionControl: { compact: true },
    maxPitch: 70,
  });
  el.__streetoMap = map;
  setTimeout(() => map.resize(), 200);
  return map;
}

function fallbackMap(el, message) {
  if (!el) return;
  el.innerHTML =
    '<div class="ug-map__fallback">' +
    '<strong>' + t('Map unavailable') + '</strong>' +
    '<span>' + message + '</span>' +
    '</div>';
}

/* ── run maps (My Underground) ───────────────────────────────────── */
function initRunMaps() {
  document.querySelectorAll('[data-ug-run-map]').forEach((el) => {
    if (el.dataset.ready === '1') return;
    el.dataset.ready = '1';
    let track = [];
    try { track = JSON.parse(el.dataset.track || '[]'); } catch { track = []; }
    if (!Array.isArray(track)) track = [];
    const routeStart = {
      lat: toNumber(el.dataset.routeStartLat),
      lng: toNumber(el.dataset.routeStartLng),
    };
    const routeEnd = {
      lat: toNumber(el.dataset.routeEndLat),
      lng: toNumber(el.dataset.routeEndLng),
    };
    const hasTrack = track.length > 1;
    const hasRoute = routeStart.lat != null && routeStart.lng != null &&
      routeEnd.lat != null && routeEnd.lng != null;
    if (!hasTrack && !hasRoute) return;
    if (!hasMap) {
      fallbackMap(el, t('The MapLibre library is not available.'));
      return;
    }
    const first = hasTrack ? track[0] : routeStart;
    const map = buildMap(el, {
      center: [Number(first.lng), Number(first.lat)],
      zoom: 13,
      pitch: 55,
      bearing: -18,
    });
    map.on('load', () => {
      if (track.length > 2) {
        routeLayer(map, track);
      } else if (hasRoute) {
        // The run sample is too short to show the road; the A-B route
        // geometry is the same road the regular Touge page draws.
        routeLayer(map, [
          { lat: routeStart.lat, lng: routeStart.lng },
          { lat: routeEnd.lat, lng: routeEnd.lng },
        ]);
        roadRoute(map, routeStart, routeEnd);
      } else {
        routeLayer(map, track);
      }
      const startPoint = hasRoute ? routeStart : track[0];
      const endPoint = hasRoute ? routeEnd : track[track.length - 1];
      const start = document.createElement('span');
      start.className = 'ug-runpindot ug-runpindot--a';
      start.textContent = 'A';
      new window.maplibregl.Marker({ element: start, anchor: 'center' })
        .setLngLat([Number(startPoint.lng), Number(startPoint.lat)]).addTo(map);
      const end = document.createElement('span');
      end.className = 'ug-runpindot ug-runpindot--b';
      end.textContent = 'B';
      new window.maplibregl.Marker({ element: end, anchor: 'center' })
        .setLngLat([Number(endPoint.lng), Number(endPoint.lat)]).addTo(map);
    });
  });
}

/* ── event page ──────────────────────────────────────────────────── */
function initEvent(root) {
  const eventId = Number(root.dataset.eventId);
  const type = root.dataset.eventType || 'drag';
  const meet = {
    lat: toNumber(root.dataset.meetLat),
    lng: toNumber(root.dataset.meetLng),
  };
  const routeStart = {
    lat: toNumber(root.dataset.routeStartLat),
    lng: toNumber(root.dataset.routeStartLng),
  };
  const routeEnd = {
    lat: toNumber(root.dataset.routeEndLat),
    lng: toNumber(root.dataset.routeEndLng),
  };
  const radius = toNumber(root.dataset.arrivalRadius) || 350;
  const canRace = root.dataset.canRace === '1';
  const uploadBase = root.dataset.uploadUrl || '/uploads';
  const mapEl = root.querySelector('[data-ug-map]');
  const enter = root.querySelector('[data-ug-enter]');
  const gpsEl = root.querySelector('[data-ug-gps]');
  const arrivalEl = root.querySelector('[data-ug-arrival]');
  const lock = document.querySelector('[data-ug-lock]');
  // The shell is a stacking context, so the lock screen must live on <body>
  // to cover the fixed tab bar and the top bar.
  if (lock && lock.parentElement !== document.body) document.body.appendChild(lock);
  const raceStatus = document.querySelector('[data-ug-race-status]');
  const unlock = document.querySelector('[data-ug-unlock]');
  const speedEl = document.querySelector('[data-ug-speed]');
  const topEl = document.querySelector('[data-ug-top]');
  const avgEl = document.querySelector('[data-ug-avg]');
  const distanceEl = document.querySelector('[data-ug-distance]');
  const accelEl = document.querySelector('[data-ug-accel]');
  const markers = new Map();

  let map = null;
  let followId = null;
  let watchId = null;
  let myPosition = null;
  let lastPublished = 0;
  let publishing = false;
  let lastFix = null;
  let race = null;
  let wakeLock = null;
  let mapReady = false;

  const setGps = (message) => { if (gpsEl) gpsEl.textContent = message; };
  const setRaceStatus = (message) => { if (raceStatus) raceStatus.textContent = message; };

  function initMap() {
    if (!mapEl) return;
    if (!hasMap) {
      fallbackMap(mapEl, t('The live map needs the MapLibre library.'));
      return;
    }
    const center = routeStart.lat != null && routeStart.lng != null
      ? [(routeStart.lng + routeEnd.lng) / 2, (routeStart.lat + routeEnd.lat) / 2]
      : [meet.lng, meet.lat];
    map = buildMap(mapEl, {
      center,
      zoom: type === 'touge' ? 12 : 14,
      pitch: type === 'touge' ? 55 : 42,
      bearing: type === 'touge' ? -22 : -12,
    });
    map.on('load', () => {
      mapReady = true;
      // The meeting spot.
      const pin = document.createElement('span');
      pin.className = 'ug-meetpin';
      pin.innerHTML = '<span></span>';
      new window.maplibregl.Marker({ element: pin, anchor: 'bottom' })
        .setLngLat([meet.lng, meet.lat]).addTo(map);

      if (type === 'touge' && routeStart.lat != null && routeEnd.lat != null) {
        routeLayer(map, [
          { lat: routeStart.lat, lng: routeStart.lng },
          { lat: routeEnd.lat, lng: routeEnd.lng },
        ]);
        roadRoute(map, routeStart, routeEnd);
        const a = document.createElement('span');
        a.className = 'ug-runpindot ug-runpindot--a';
        a.textContent = 'A';
        new window.maplibregl.Marker({ element: a, anchor: 'center' })
          .setLngLat([routeStart.lng, routeStart.lat]).addTo(map);
        const b = document.createElement('span');
        b.className = 'ug-runpindot ug-runpindot--b';
        b.textContent = 'B';
        new window.maplibregl.Marker({ element: b, anchor: 'center' })
          .setLngLat([routeEnd.lng, routeEnd.lat]).addTo(map);
      }

      try {
        const track = JSON.parse(root.dataset.track || '[]');
        if (Array.isArray(track) && track.length > 1) routeLayer(map, track);
        else if (type === 'touge' && routeStart.lat != null && routeEnd.lat != null) roadRoute(map, routeStart, routeEnd);
      } catch { /* no saved route */ }
    });
    map.on('dragstart', () => { followId = null; });
  }

  function markerElement(row) {
    const wrap = document.createElement('button');
    wrap.type = 'button';
    wrap.className = `ug-marker${followId === row.user_id ? ' is-followed' : ''}`;
    wrap.setAttribute('aria-label', t('Follow {name}', { name: row.display_name || row.username || t('Underground host') }));
    const avatar = document.createElement('span');
    avatar.className = 'ug-marker__avatar';
    const url = avatarUrl(row.avatar, uploadBase);
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.loading = 'lazy';
      avatar.appendChild(img);
    } else {
      avatar.textContent = initials(row.display_name || row.username || 'H');
    }
    const speed = document.createElement('span');
    speed.className = 'ug-marker__speed';
    speed.textContent = `${Math.round(Number(row.speed) || 0)}`;
    wrap.appendChild(avatar);
    wrap.appendChild(speed);
    wrap.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      followId = row.user_id;
      if (map && row.lat != null && row.lng != null) {
        map.easeTo({ center: [row.lng, row.lat], zoom: Math.max(map.getZoom(), 15.5), duration: 850 });
      }
      drawMarkers(lastRows);
    });
    return wrap;
  }

  let lastRows = [];
  function drawMarkers(rows) {
    lastRows = Array.isArray(rows) ? rows : [];
    if (!map || !mapReady) return;
    markers.forEach((marker) => marker.remove());
    markers.clear();
    for (const row of lastRows) {
      const lat = toNumber(row.lat);
      const lng = toNumber(row.lng);
      if (lat == null || lng == null) continue;
      const el = markerElement(row);
      const marker = new window.maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([lng, lat])
        .addTo(map);
      markers.set(row.user_id, marker);
      if (followId === row.user_id) {
        map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 15.5), duration: 500 });
      }
    }
  }

  async function pollLive() {
    try {
      const response = await fetch(`/api/underground/${eventId}/live`, {
        credentials: 'same-origin',
        headers: { 'x-requested-with': 'fetch' },
      });
      if (!response.ok) return;
      const payload = await response.json();
      if (payload.ok) drawMarkers(payload.participants || []);
    } catch { /* keep the last known positions */ }
  }

  function publish(position) {
    if (!position || publishing) return;
    const now = Date.now();
    if (now - lastPublished < 3500) return;
    lastPublished = now;
    publishing = true;
    let speed = position.coords.speed != null ? Math.max(0, position.coords.speed * 3.6) : null;
    if (speed == null && lastFix) {
      const seconds = Math.max(0.35, (now - lastFix.t) / 1000);
      const metres = haversineM(lastFix, {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      });
      speed = (metres / seconds) * 3.6;
    }
    lastFix = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      t: now,
    };
    fetch(`/api/underground/${eventId}/position`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'fetch',
        'x-csrf-token': csrf,
      },
      body: JSON.stringify({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        speed,
        heading: position.coords.heading,
      }),
    }).catch(() => {}).finally(() => { publishing = false; });
  }

  function updateArrival() {
    if (!enter || !canRace) return;
    if (!myPosition) {
      setGps(t('Waiting for GPS…'));
      enter.disabled = true;
      if (arrivalEl) arrivalEl.textContent = t('Allow location access to arm race mode.');
      return;
    }
    const distance = haversineM(
      { lat: myPosition.coords.latitude, lng: myPosition.coords.longitude },
      meet,
    );
    if (distance <= radius) {
      enter.disabled = false;
      setGps(t('You are at the spot.'));
      if (arrivalEl) arrivalEl.textContent = t('Race mode is armed. Start the lock screen when you are ready.');
    } else {
      enter.disabled = true;
      setGps(t('{n} m from the spot.', { n: Math.round(distance) }));
      if (arrivalEl) arrivalEl.textContent = t('Race mode unlocks within {n} m of the meeting spot.', { n: radius });
    }
  }

  async function requestWakeLock() {
    if (!race) return;
    if (!('wakeLock' in navigator)) {
      setRaceStatus(t('Screen wake lock is not available in this browser. Keep this page open.'));
      return;
    }
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        if (race && !document.hidden) {
          setTimeout(() => requestWakeLock(), 400);
        }
      });
      setRaceStatus(t('Screen stays awake while race mode is locked.'));
    } catch {
      setRaceStatus(t('Allow wake lock or keep the screen on to record the full run.'));
    }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  function racePoint(position) {
    const now = Date.now();
    let speed = position.coords.speed != null ? Math.max(0, position.coords.speed * 3.6) : null;
    if (speed == null && race.last) {
      const timed = Math.max(0.2, (now - race.last.t) / 1000);
      const metres = haversineM(
        { lat: race.last.lat, lng: race.last.lng },
        { lat: position.coords.latitude, lng: position.coords.longitude },
      );
      speed = (metres / timed) * 3.6;
    }
    const point = {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
      t: now,
      speed: Math.max(0, speed || 0),
    };
    if (race.last) {
      const metres = haversineM(race.last, point);
      if (metres < 1500) race.distance += metres / 1000;
      const seconds = Math.max(0.2, (now - race.last.t) / 1000);
      const accel = ((point.speed - race.last.speed) / 3.6) / seconds;
      if (accel > race.accel) race.accel = accel;
    }
    race.points.push(point);
    race.last = point;
    race.top = Math.max(race.top, point.speed);
    const duration = Math.max(1, (now - race.startedAt) / 1000);
    race.avg = (race.distance / duration) * 3600;
    if (speedEl) speedEl.textContent = String(Math.round(point.speed));
    if (topEl) topEl.textContent = String(Math.round(race.top));
    if (avgEl) avgEl.textContent = String(Math.round(race.avg));
    if (distanceEl) distanceEl.textContent = race.distance.toFixed(2);
    if (accelEl) accelEl.textContent = race.accel.toFixed(2);
  }

  function onPosition(position) {
    myPosition = position;
    publish(position);
    updateArrival();
    if (race) racePoint(position);
  }

  function startWatching() {
    if (!navigator.geolocation) {
      setGps(t('This browser has no GPS support.'));
      return;
    }
    watchId = navigator.geolocation.watchPosition(onPosition, (error) => {
      setGps(error.code === 1
        ? t('Location permission was denied. Allow it in the browser to arm race mode.')
        : t('Could not get a GPS fix. Move into the open and try again.'));
    }, {
      enableHighAccuracy: true,
      maximumAge: 900,
      timeout: 12000,
    });
  }

  function startRace() {
    if (!canRace || !myPosition || race) return;
    race = {
      startedAt: Date.now(),
      last: null,
      points: [],
      top: 0,
      avg: 0,
      distance: 0,
      accel: 0,
      saving: false,
    };
    if (lock) lock.hidden = false;
    document.body.style.overflow = 'hidden';
    setRaceStatus(t('Recording…'));
    if (unlock) unlock.value = '0';
    requestWakeLock();
  }

  async function finishRace() {
    if (!race || race.saving) return;
    if (race.points.length < 2) {
      setRaceStatus(t('Keep the lock screen on a little longer — no GPS movement was recorded yet.'));
      if (unlock) unlock.value = '0';
      return;
    }
    race.saving = true;
    setRaceStatus(t('Saving the run…'));
    try {
      const response = await fetch(`/api/underground/${eventId}/run`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          'x-requested-with': 'fetch',
          'x-csrf-token': csrf,
        },
        body: JSON.stringify({ track: race.points }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok) throw new Error(payload.error || t('Could not save the run.'));
      releaseWakeLock();
      setRaceStatus(t('Run saved. Opening your summary…'));
      setTimeout(() => window.location.reload(), 650);
    } catch (error) {
      race.saving = false;
      if (unlock) unlock.value = '0';
      setRaceStatus(error.message || t('Could not save the run. Slide again to retry.'));
      requestWakeLock();
    }
  }

  if (mapEl) initMap();
  if (enter) enter.addEventListener('click', startRace);
  if (unlock) {
    unlock.addEventListener('input', () => {
      if (Number(unlock.value) >= 99) finishRace();
    });
  }
  if (lock) {
    lock.addEventListener('contextmenu', (event) => event.preventDefault());
  }
  document.addEventListener('visibilitychange', () => {
    if (race && !document.hidden) requestWakeLock();
  });
  window.addEventListener('beforeunload', releaseWakeLock);

  startWatching();
  if (map) pollLive();
  setInterval(() => {
    if (!document.hidden) pollLive();
  }, 4000);
}

function initSummaryModal() {
  const summary = document.querySelector('[data-ug-summary]');
  if (!summary || summary.dataset.ugSummaryOpen !== '1') return;
  const close = summary.querySelector('[data-ug-summary-close]');
  const backdrop = document.createElement('div');
  backdrop.className = 'ug-summary-backdrop';
  document.body.appendChild(backdrop);
  document.body.appendChild(summary);
  summary.classList.add('is-modal');
  document.body.style.overflow = 'hidden';
  const closeModal = () => {
    summary.classList.remove('is-modal');
    summary.remove();
    backdrop.remove();
    document.body.style.overflow = '';
  };
  close?.addEventListener('click', closeModal);
  backdrop.addEventListener('click', closeModal);
  setTimeout(() => {
    const map = summary.querySelector('[data-ug-run-map]');
    if (map?.__streetoMap) map.__streetoMap.resize();
  }, 80);
}

initRunMaps();
initSummaryModal();
const eventRoot = document.querySelector('[data-ug-event]');
if (eventRoot) initEvent(eventRoot);
