/* ══════════════════════════════════════════════════════════════════
   STREETO — Touge Route Picker
   One map: tap once for Start (A), tap again for Finish (B).

   - street names fill in from reverse geocoding on every move
   - tapping a pin takes it off the map (and leaves the preview)
   - the road line comes from OSRM, the heights from Open-Meteo
   - right-hand HUD: clear, 3D preview, full screen
   - top banner: distance; bottom banner: A and B street names
   ══════════════════════════════════════════════════════════════════ */

import { t } from './i18n.js';
import { MAP_STYLE } from './map-style.js';

const hasMaplibre = typeof window.maplibregl !== 'undefined';
const DEFAULT_CENTER = [44.8271, 41.7151];
const fs = (num) => (num === null || num === undefined || num === '') ? null : (Number.isFinite(Number(num)) ? Number(num) : null);

const ICON_EYE = '<path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.6"/>';
const ICON_EXPAND = '<path d="M9 3H3v6"/><path d="M21 9V3h-6"/><path d="M15 21h6v-6"/><path d="M3 15v6h6"/>';
const ICON_COLLAPSE = '<path d="M9 3v6H3"/><path d="M21 9h-6V3"/><path d="M15 21v-6h6"/><path d="M3 15h6v6"/>';
const ICON_X = '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>';
const ICON_COMPASS = '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2.2 5.3-5.3 2.2 2.2-5.3z"/>';

const svgIcon = (paths) =>
  `<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;

/** Avatar-style A/B marker: white ring, green for A, red for B. */
function pinElement(label, kind) {
  const el = document.createElement('span');
  el.className = `touge-pin touge-pin--${kind}`;
  const inner = document.createElement('span');
  inner.className = 'touge-pin__inner';
  inner.textContent = label;
  el.appendChild(inner);
  return el;
}

/** Build a map instance with the app's dark style. */
function buildMap(el, { center, zoom = 13, interactive = true, pitch = 0, bearing = 0 }) {
  const map = new window.maplibregl.Map({
    container: el,
    style: MAP_STYLE,
    center,
    zoom,
    pitch,
    bearing,
    interactive,
    attributionControl: { compact: true },
    dragRotate: interactive,
    touchZoomRotate: interactive,
    maxPitch: 70,
  });
  if (!interactive) {
    map.touchZoomRotate.disable();
    map.scrollZoom.disable();
    map.dragPan.disable();
    map.doubleClickZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
  }
  el.__streetoMap = map;
  return map;
}

/**
 * Run fn as soon as the style can take sources and layers.
 *
 * `isStyleLoaded()` goes false again for a moment whenever a source is
 * added, so a second call right after the first (route line, then the
 * 3D ribbon) would otherwise wait for a `load` that has already fired.
 */
function whenStyleReady(map, fn) {
  if (map.__streetoStyleReady) {
    fn();
    return;
  }
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    map.__streetoStyleReady = true;
    map.off('load', run);
    map.off('idle', run);
    fn();
  };
  if (map.isStyleLoaded()) {
    run();
    return;
  }
  map.on('load', run);
  map.on('idle', run);
  // Already past the load event but briefly busy: try again shortly.
  if (typeof map.getStyle === 'function' && map.getStyle()?.layers) {
    setTimeout(() => { if (map.isStyleLoaded()) run(); }, 140);
  }
}

function watchVisibility(el, map) {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      map.resize();
      observer.disconnect();
    });
  }, { rootMargin: '200px' });
  observer.observe(el);
  setTimeout(() => map.resize(), 250);
}

/** The floating column of controls on the right of the map. */
function ensureHud(frame) {
  let hud = frame.querySelector('.touge-hud');
  if (!hud) {
    hud = document.createElement('div');
    hud.className = 'touge-hud';
    frame.appendChild(hud);
  }
  return hud;
}

/** A small compass in the HUD; it turns with the map and resets north. */
function initCompass(frame, map) {
  if (!frame || frame.dataset.compassReady === '1') return;
  frame.dataset.compassReady = '1';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'touge-hud__btn touge-hud__btn--compass';
  btn.innerHTML = svgIcon(ICON_COMPASS);
  btn.title = t('Reset north');
  btn.setAttribute('aria-label', t('Reset north'));
  btn.addEventListener('click', () => {
    map.easeTo({ bearing: 0, duration: 500 });
  });

  const icon = btn.firstElementChild;
  const tick = () => {
    if (icon) icon.style.transform = `rotate(${-map.getBearing()}deg)`;
  };
  map.on('rotate', tick);
  tick();

  ensureHud(frame).appendChild(btn);
}

/**
 * Full screen for a map frame. Uses the Fullscreen API where it is
 * available and a fixed-position fallback where it is not; either way
 * the map is resized so panning and pin drops keep working.
 */
function initFullscreen(frame, map) {
  if (!frame || frame.dataset.fsReady === '1') return;
  frame.dataset.fsReady = '1';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'touge-hud__btn';
  btn.innerHTML = svgIcon(ICON_EXPAND);
  btn.title = t('Full screen');
  btn.setAttribute('aria-label', t('Full screen'));
  ensureHud(frame).appendChild(btn);

  let fallback = false;

  const isFull = () => document.fullscreenElement === frame || fallback;

  const resize = () => {
    setTimeout(() => map.resize(), 60);
    setTimeout(() => map.resize(), 260);
  };

  const refresh = () => {
    const on = isFull();
    btn.innerHTML = svgIcon(on ? ICON_COLLAPSE : ICON_EXPAND);
    btn.title = on ? t('Exit full screen') : t('Full screen');
    btn.setAttribute('aria-label', btn.title);
    btn.classList.toggle('is-on', on);
    resize();
    frame.dispatchEvent(new CustomEvent('streeto:fullscreen', { detail: { on } }));
  };

  const enterFallback = () => {
    fallback = true;
    frame.classList.add('is-fs-fallback');
    document.body.classList.add('touge-fs-lock');
    refresh();
  };

  const leaveFallback = () => {
    if (!fallback) return;
    fallback = false;
    frame.classList.remove('is-fs-fallback');
    document.body.classList.remove('touge-fs-lock');
  };

  btn.addEventListener('click', async () => {
    if (isFull()) {
      if (document.fullscreenElement) {
        try { await document.exitFullscreen(); } catch { /* already out */ }
      }
      leaveFallback();
      refresh();
      return;
    }
    try {
      if (typeof frame.requestFullscreen !== 'function') throw new Error('no fullscreen api');
      await frame.requestFullscreen();
      // Some embedded browsers accept the call but never enter full
      // screen - fall back so the button always does something visible.
      setTimeout(() => {
        if (document.fullscreenElement !== frame && !fallback) enterFallback();
      }, 350);
    } catch {
      enterFallback();
    }
    refresh();
  });

  document.addEventListener('fullscreenchange', () => {
    if (document.fullscreenElement === frame) leaveFallback();
    refresh();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !fallback) return;
    leaveFallback();
    refresh();
  });
  window.addEventListener('resize', resize);
}

/** lat/lng -> place name through our own reverse-geocode proxy. */
async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`/api/geocode/reverse?lat=${lat}&lng=${lng}`, {
      credentials: 'same-origin',
      headers: { 'x-requested-with': 'fetch' },
    });
    const data = await res.json();
    if (data.ok && data.place) return data.place.name || data.place.label || '';
  } catch { /* naming is a bonus, never a blocker */ }
  return '';
}

/** The road line and its elevation profile, from our server proxy. */
async function fetchProfile(start, end) {
  const fallback = {
    coordinates: [[start[1], start[0]], [end[1], end[0]]],
    elevations: null,
    km: null,
    gain: null,
    loss: null,
    min: null,
    max: null,
  };
  try {
    const res = await fetch(
      `/api/route/profile?from=${start[0]},${start[1]}&to=${end[0]},${end[1]}`,
      { credentials: 'same-origin', headers: { 'x-requested-with': 'fetch' } },
    );
    const data = await res.json();
    if (data.ok && Array.isArray(data.coordinates) && data.coordinates.length > 1) {
      return data;
    }
  } catch { /* fall through to a straight line */ }
  return fallback;
}

/** Paint (or clear) the route line on a map. */
function paintRoute(map, coordinates) {
  const feature = {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates },
    properties: {},
  };
  whenStyleReady(map, () => {
    const source = map.getSource('touge-route');
    if (source) {
      source.setData(feature);
      return;
    }
    map.addSource('touge-route', { type: 'geojson', data: feature });
    map.addLayer({
      id: 'touge-route-line',
      type: 'line',
      source: 'touge-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#1fe0ff',
        'line-width': 4,
        'line-opacity': 0.95,
        'line-dasharray': [2, 2],
      },
    });
  });
}

/** A thin 3D ribbon standing up from the map, one segment per sample. */
function paintCurtain(map, coordinates, elevations) {
  if (!Array.isArray(elevations) || !coordinates || coordinates.length !== elevations.length || coordinates.length < 2) return;
  const min = Math.min(...elevations);
  const features = [];
  for (let i = 1; i < coordinates.length; i += 1) {
    const [ax, ay] = coordinates[i - 1];
    const [bx, by] = coordinates[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-9;
    const ox = (-dy / len) * 0.00007;
    const oy = (dx / len) * 0.00007;
    const height = Math.max(2, elevations[i] - min + 3);
    features.push({
      type: 'Feature',
      properties: { h: height },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [ax + ox, ay + oy], [bx + ox, by + oy],
          [bx - ox, by - oy], [ax - ox, ay - oy], [ax + ox, ay + oy],
        ]],
      },
    });
  }

  whenStyleReady(map, () => {
    if (map.getLayer('touge-curtain')) map.removeLayer('touge-curtain');
    if (map.getSource('touge-curtain')) map.removeSource('touge-curtain');
    map.addSource('touge-curtain', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });
    map.addLayer({
      id: 'touge-curtain',
      type: 'fill-extrusion',
      source: 'touge-curtain',
      paint: {
        'fill-extrusion-color': '#1fe0ff',
        'fill-extrusion-height': ['get', 'h'],
        'fill-extrusion-opacity': 0.55,
      },
    });
    // The dashed road line stays readable on top of the ribbon.
    if (map.getLayer('touge-route-line')) map.moveLayer('touge-route-line');
  });
}

function removeCurtain(map) {
  if (!map.isStyleLoaded()) return;
  if (map.getLayer('touge-curtain')) map.removeLayer('touge-curtain');
  if (map.getSource('touge-curtain')) map.removeSource('touge-curtain');
}

/** The banner over the map: distance, and the climb when we have it. */
function updateBanner(el, profile) {
  if (!el) return;
  const km = Number(profile?.km);
  if (!Number.isFinite(km)) {
    el.hidden = true;
    el.replaceChildren();
    return;
  }
  const bits = [`<strong>${km.toFixed(1)} km</strong>`];
  if (Number.isFinite(profile.gain) && Number.isFinite(profile.loss)) {
    bits.push(`<span>↑ ${profile.gain} m</span>`, `<span>↓ ${profile.loss} m</span>`);
  }
  el.innerHTML = bits.join('');
  el.hidden = false;
}

/** The elevation profile chart under the map. */
function renderProfile(el, profile) {
  if (!el) return;
  const elevations = profile?.elevations;
  if (!Array.isArray(elevations) || elevations.length < 2) {
    el.hidden = true;
    el.replaceChildren();
    return;
  }

  const w = 600;
  const h = 90;
  const pad = 8;
  const min = Math.min(...elevations);
  const max = Math.max(...elevations);
  const span = Math.max(1, max - min);
  const points = elevations.map((value, index) => {
    const x = pad + (index / (elevations.length - 1)) * (w - 2 * pad);
    const y = h - pad - ((value - min) / span) * (h - 2 * pad);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `M${pad},${h - pad} L${points.join(' L')} L${w - pad},${h - pad} Z`;

  const gain = Number.isFinite(profile.gain) ? profile.gain : 0;
  const loss = Number.isFinite(profile.loss) ? profile.loss : 0;

  el.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${area}" fill="rgba(31,224,255,.16)"/>
      <polyline points="${points.join(' ')}" fill="none" stroke="#1fe0ff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>
    <div class="touge-profile__labels">
      <span>${min} m</span>
      <span>↑ ${gain} m · ↓ ${loss} m</span>
      <span>${max} m</span>
    </div>`;
  el.hidden = false;
}

/**
 * Frame two points without the tilt stealing the zoom: the camera is
 * solved flat, then tilted. Fitting a pitched camera zooms out far too
 * much on a short run.
 */
/**
 * A flat zoom that fits two points into a box. MapLibre's
 * `cameraForBounds` wrapped the centre by 180° on this style and
 * returned a world view, so the fit is solved here.
 */
function fitZoom(bounds, width, height, padding = 40) {
  const [[lng1, lat1], [lng2, lat2]] = bounds;
  const latRad = (((lat1 + lat2) / 2) * Math.PI) / 180;
  const R = 6378137;
  const spanX = (Math.abs(lng2 - lng1) * Math.PI * R * Math.cos(latRad)) / 180;
  const spanY = (Math.abs(lat2 - lat1) * Math.PI * R) / 180;
  const availW = Math.max(80, width - padding * 2);
  const availH = Math.max(80, height - padding * 2);
  const metresPerPixel = Math.max(spanX / availW, spanY / availH);
  if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) return 13;
  const zoom = Math.log2((156543.03392 * Math.cos(latRad)) / metresPerPixel);
  return Math.max(2, Math.min(zoom, 16));
}

function frameRoute(map, start, end, tilt) {
  const apply = () => {
    map.resize();
    const box = map.getContainer().getBoundingClientRect();
    const bounds = [[start[1], start[0]], [end[1], end[0]]];
    map.easeTo({
      center: [(start[1] + end[1]) / 2, (start[0] + end[0]) / 2],
      zoom: fitZoom(bounds, box.width, box.height, 60),
      pitch: tilt,
      bearing: -20,
      duration: 850,
    });
  };
  apply();
  // The container may still be settling after a full screen change.
  setTimeout(apply, 260);
}

/**
 * Move the widget stack onto the map while it is full screen, and put
 * it back below the map when the window closes. The same stack is used
 * in the setup form, the preview and full screen.
 */
function initWidgets(frame, widgets, map) {
  if (!frame || !widgets) return;
  const home = widgets.parentElement;
  const next = widgets.nextElementSibling;
  frame.addEventListener('streeto:fullscreen', (event) => {
    if (event.detail?.on) {
      frame.appendChild(widgets);
      widgets.classList.add('touge-widgets--overlay');
    } else {
      widgets.classList.remove('touge-widgets--overlay');
      if (home) home.insertBefore(widgets, next && next.parentElement === home ? next : null);
    }
    setTimeout(() => map.resize(), 80);
  });
}

/* ── read-only 3D preview (the saved meetup) ───────────────────── */
function initPreview(el) {
  if (el.dataset.ready === '1' || !hasMaplibre) return;
  el.dataset.ready = '1';

  const lat = fs(el.dataset.lat);
  const lng = fs(el.dataset.lng);
  const endLat = fs(el.dataset.endLat);
  const endLng = fs(el.dataset.endLng);
  if (lat === null || lng === null || endLat === null || endLng === null) return;

  const start = [lat, lng];
  const end = [endLat, endLng];
  const frame = el.closest('.touge-map');
  const card = el.closest('.routecard') || el.parentElement;
  const banner = card?.querySelector('[data-route-length]');
  const profileEl = card?.querySelector('[data-route-profile]');
  const widgets = card?.querySelector('.touge-widgets');

  // The host's own view of the route, saved with the meetup. Falling
  // back to a computed fit only for older meetups.
  let savedView = null;
  try {
    const view = JSON.parse(el.dataset.view || '');
    const vLat = Number(view?.lat);
    const vLng = Number(view?.lng);
    const vZoom = Number(view?.zoom);
    if ([vLat, vLng, vZoom].every(Number.isFinite)) {
      savedView = { lat: vLat, lng: vLng, zoom: Math.max(2, Math.min(vZoom, 18)) };
    }
  } catch { /* no saved view */ }

  // A saved camera angle can put one end of a short route outside a phone
  // screen. On a phone, fit both pins instead; keep the host's view on
  // larger screens where there is room for it.
  const useSavedView = Boolean(savedView) && !window.matchMedia('(max-width: 640px)').matches;

  const map = buildMap(el, {
    center: useSavedView ? [savedView.lng, savedView.lat] : [(lng + endLng) / 2, (lat + endLat) / 2],
    zoom: useSavedView ? savedView.zoom : 13,
    // Free camera: the track can be zoomed, panned and rotated, but the
    // pins are fixed - nothing here changes A or B.
    interactive: true,
    pitch: 55,
    bearing: -20,
  });

  new window.maplibregl.Marker({ element: pinElement('A', 'start'), anchor: 'bottom' })
    .setLngLat([lng, lat]).addTo(map);
  new window.maplibregl.Marker({ element: pinElement('B', 'finish'), anchor: 'bottom' })
    .setLngLat([endLng, endLat]).addTo(map);

  if (frame) {
    initCompass(frame, map);
    initFullscreen(frame, map);
    initWidgets(frame, widgets, map);
  }

  fetchProfile(start, end).then((profile) => {
    paintRoute(map, profile.coordinates);
    updateBanner(banner, profile);
    renderProfile(profileEl, profile);
    if (profile.elevations) paintCurtain(map, profile.coordinates, profile.elevations);

    // Frame the camera flat, then tilt - fitting a pitched camera zooms
    // far too much out. Wait until the card has a height, because a
    // container measured at zero would produce a world-wide view.
    const bounds = [[lng, lat], [endLng, endLat]];
    const frameTheMap = (attempt = 0) => {
      const box = el.getBoundingClientRect();
      if (box.height < 40 && attempt < 12) {
        setTimeout(() => frameTheMap(attempt + 1), 160);
        return;
      }
      map.resize();
      if (useSavedView) {
        map.jumpTo({
          center: [savedView.lng, savedView.lat],
          zoom: savedView.zoom,
          pitch: 55,
          bearing: -20,
        });
        return;
      }
      const width = box.width || el.clientWidth;
      const height = box.height || el.clientHeight;
      map.jumpTo({
        center: [(lng + endLng) / 2, (lat + endLat) / 2],
        zoom: fitZoom(bounds, width, height, 72),
        pitch: 55,
        bearing: -20,
      });
    };
    whenStyleReady(map, () => requestAnimationFrame(() => frameTheMap()));
    setTimeout(() => frameTheMap(), 600);
  });

  watchVisibility(el, map);
}

/* ── interactive picker inside the meetup form ─────────────────── */
export function initTougePicker(wrap) {
  if (wrap.dataset.ready === '1' || !hasMaplibre) return;
  wrap.dataset.ready = '1';

  const mapEl = wrap.querySelector('[data-touge-map]');
  const form = wrap.closest('form');
  if (!mapEl || !form) return;

  const mapFrame = wrap.querySelector('.touge-map');
  const startLatF = form.querySelector('[name="route_start_lat"]');
  const startLngF = form.querySelector('[name="route_start_lng"]');
  const endLatF = form.querySelector('[name="route_end_lat"]');
  const endLngF = form.querySelector('[name="route_end_lng"]');
  const startNameF = form.querySelector('[name="route_start_name"]');
  const endNameF = form.querySelector('[name="route_end_name"]');
  const viewField = form.querySelector('[name="route_view"]');
  const lengthEl = wrap.querySelector('[data-route-length]') || form.querySelector('[data-route-length]');
  const profileEl = wrap.querySelector('[data-route-profile]');
  const widgets = wrap.querySelector('.touge-widgets');
  const namesEl = wrap.querySelector('[data-route-names]');
  const nameAEl = wrap.querySelector('[data-route-name-a]');
  const nameBEl = wrap.querySelector('[data-route-name-b]');
  const statusEl = wrap.querySelector('[data-pin-status]');
  if (!startLatF || !startLngF || !endLatF || !endLngF) return;

  const status = (message, kind = '') => {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.toggle('is-ok', kind === 'ok');
    statusEl.classList.toggle('is-bad', kind === 'bad');
  };

  // 0 = waiting for A, 1 = waiting for B, 2 = both set
  let step = 0;
  let start = null;
  let end = null;
  let startMarker = null;
  let endMarker = null;
  let previewMode = false;
  let suppressClick = false;
  let startToken = 0;
  let endToken = 0;

  const map = buildMap(mapEl, { center: DEFAULT_CENTER, zoom: 11, interactive: true, pitch: 30, bearing: -20 });

  // Remember the camera the host leaves the map at, so the saved
  // preview opens on exactly the same view.
  const rememberView = () => {
    if (!viewField) return;
    const center = map.getCenter();
    viewField.value = JSON.stringify({
      lat: Number(center.lat.toFixed(6)),
      lng: Number(center.lng.toFixed(6)),
      zoom: Number(map.getZoom().toFixed(2)),
    });
  };
  map.on('moveend', rememberView);
  rememberView();

  /** Let the page (weather strip) know the route changed. */
  const announce = () => {
    form.dispatchEvent(new CustomEvent('streeto:route', { bubbles: true }));
  };

  /** The bottom banner: the two street names. */
  const syncNames = () => {
    if (!namesEl) return;
    const a = (startNameF?.value || '').trim();
    const b = (endNameF?.value || '').trim();
    if (nameAEl) nameAEl.textContent = a || t('Not set');
    if (nameBEl) nameBEl.textContent = b || t('Not set');
    namesEl.hidden = !start && !end;
  };

  startNameF?.addEventListener('input', syncNames);
  endNameF?.addEventListener('input', syncNames);

  const refreshRoute = async () => {
    if (!start || !end) {
      paintRoute(map, []);
      updateBanner(lengthEl, null);
      renderProfile(profileEl, null);
      removeCurtain(map);
      return;
    }
    const profile = await fetchProfile(start, end);
    paintRoute(map, profile.coordinates);
    updateBanner(lengthEl, profile);
    renderProfile(profileEl, profile);
    if (previewMode) paintCurtain(map, profile.coordinates, profile.elevations);
  };

  const nameFor = async (kind, lat, lng) => {
    const token = kind === 'start' ? ++startToken : ++endToken;
    const name = await reverseGeocode(lat, lng);
    if (!name) return;
    if (kind === 'start') {
      if (token !== startToken || !startNameF) return;
      startNameF.value = name;
    } else {
      if (token !== endToken || !endNameF) return;
      endNameF.value = name;
    }
    syncNames();
  };

  /* ── 3D preview mode ─────────────────────────────────────────── */
  const previewBtn = document.createElement('button');
  previewBtn.type = 'button';
  previewBtn.className = 'touge-hud__btn';
  previewBtn.innerHTML = svgIcon(ICON_EYE);
  previewBtn.title = t('Preview 3D route');
  previewBtn.setAttribute('aria-label', t('Preview 3D route'));

  const setPreview = (on) => {
    previewMode = on;
    previewBtn.classList.toggle('is-on', on);
    const label = on ? t('Exit preview') : t('Preview 3D route');
    previewBtn.title = label;
    previewBtn.setAttribute('aria-label', label);

    if (on) {
      frameRoute(map, start, end, 58);
      fetchProfile(start, end).then((profile) => {
        paintCurtain(map, profile.coordinates, profile.elevations);
      });
      return;
    }

    removeCurtain(map);
    // Only re-frame when both ends still exist; a deleted pin leaves
    // the map where it is, ready for the next tap.
    if (start && end) frameRoute(map, start, end, 30);
    else map.easeTo({ pitch: 30, bearing: -20, duration: 500 });
  };

  previewBtn.addEventListener('click', () => {
    if (!start || !end) {
      status(t('Set Start (A) and Finish (B) first.'), 'bad');
      return;
    }
    setPreview(!previewMode);
  });

  const placeMarker = (coord, kind) => {
    const el = pinElement(kind === 'start' ? 'A' : 'B', kind);
    // Tapping a pin takes it off the map, so the point can be picked
    // again. It also leaves the 3D preview - otherwise the map would
    // stay in view-only mode with nothing to look at.
    el.addEventListener('click', (event) => {
      event.stopPropagation();
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 60);
      if (kind === 'start') removeStart();
      else removeEnd();
    });
    el.style.cursor = 'pointer';
    el.style.pointerEvents = 'auto';
    el.title = t('Tap to remove this pin');
    return new window.maplibregl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([coord[1], coord[0]])
      .addTo(map);
  };

  const setStart = (lat, lng, { fillName = true } = {}) => {
    start = [lat, lng];
    startLatF.value = lat;
    startLngF.value = lng;
    if (startMarker) startMarker.remove();
    startMarker = placeMarker(start, 'start');
    step = 1;
    syncNames();
    announce();
    if (fillName) {
      status(t('Start (A) set. Looking up the street name…'), 'ok');
      nameFor('start', lat, lng).then(() => {
        status(t('Start (A) set. Tap the map for Finish (B).'), 'ok');
      });
    } else {
      status(t('Start (A) set. Tap the map for Finish (B).'), 'ok');
    }
    refreshRoute();
  };

  const setEnd = (lat, lng, { fillName = true } = {}) => {
    end = [lat, lng];
    endLatF.value = lat;
    endLngF.value = lng;
    if (endMarker) endMarker.remove();
    endMarker = placeMarker(end, 'finish');
    step = 2;
    syncNames();
    announce();
    if (fillName) {
      status(t('Finish (B) set. Looking up the street name…'), 'ok');
      nameFor('end', lat, lng).then(() => {
        status(t('Route ready. Tap a pin to move it, or Clear to restart.'), 'ok');
      });
    } else {
      status(t('Route ready. Tap a pin to move it, or Clear to restart.'), 'ok');
    }
    refreshRoute();
  };

  const removeStart = () => {
    if (previewMode) setPreview(false);
    if (startMarker) { startMarker.remove(); startMarker = null; }
    start = null;
    startToken += 1;
    startLatF.value = '';
    startLngF.value = '';
    if (startNameF) startNameF.value = '';
    step = 0;
    syncNames();
    announce();
    refreshRoute();
    status(t('Start (A) removed. Tap the map to place it again.'), 'ok');
  };

  const removeEnd = () => {
    if (previewMode) setPreview(false);
    if (endMarker) { endMarker.remove(); endMarker = null; }
    end = null;
    endToken += 1;
    endLatF.value = '';
    endLngF.value = '';
    if (endNameF) endNameF.value = '';
    step = start ? 1 : 0;
    syncNames();
    announce();
    refreshRoute();
    status(t('Finish (B) removed. Tap the map to place it again.'), 'ok');
  };

  map.on('click', (event) => {
    if (previewMode || suppressClick) return;
    const { lat, lng } = event.lngLat;
    if (step === 0) setStart(lat, lng);
    else setEnd(lat, lng);
  });

  // Existing values (e.g. when the form comes back with a validation error)
  const existingStartLat = fs(startLatF.value);
  const existingStartLng = fs(startLngF.value);
  const existingEndLat = fs(endLatF.value);
  const existingEndLng = fs(endLngF.value);
  if (existingStartLat !== null && existingStartLng !== null) {
    setStart(existingStartLat, existingStartLng, { fillName: false });
    if (existingEndLat !== null && existingEndLng !== null) {
      setEnd(existingEndLat, existingEndLng, { fillName: false });
    }
  } else {
    status(t('Tap the map to set Start (A), then tap for Finish (B).'));
  }
  syncNames();

  /* clear: the same action from the row above the map and the HUD */
  const clearRoute = () => {
    if (previewMode) setPreview(false);
    if (startMarker) { startMarker.remove(); startMarker = null; }
    if (endMarker) { endMarker.remove(); endMarker = null; }
    start = null;
    end = null;
    startToken += 1;
    endToken += 1;
    startLatF.value = '';
    startLngF.value = '';
    endLatF.value = '';
    endLngF.value = '';
    if (startNameF) startNameF.value = '';
    if (endNameF) endNameF.value = '';
    step = 0;
    syncNames();
    announce();
    removeCurtain(map);
    refreshRoute();
    status(t('Cleared. Tap the map to set Start (A).'));
  };

  wrap.querySelector('[data-pin-clear]')?.addEventListener('click', clearRoute);

  /* HUD: clear, preview, full screen (the clear stays reachable in full screen) */
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'touge-hud__btn';
  clearBtn.innerHTML = svgIcon(ICON_X);
  clearBtn.title = t('Clear route');
  clearBtn.setAttribute('aria-label', t('Clear route'));
  clearBtn.addEventListener('click', clearRoute);

  if (mapFrame) {
    const hud = ensureHud(mapFrame);
    hud.appendChild(clearBtn);
    initCompass(mapFrame, map);
    hud.appendChild(previewBtn);
    initFullscreen(mapFrame, map);
    initWidgets(mapFrame, widgets, map);
  }

  /* GPS sets whichever point is missing, and centres the map there */
  const gpsBtn = wrap.querySelector('[data-gps]');
  gpsBtn?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      status(t('This browser has no GPS support. Tap the map instead.'), 'bad');
      return;
    }
    status(t('Getting your position…'));
    gpsBtn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        gpsBtn.disabled = false;
        const { latitude, longitude } = position.coords;
        if (previewMode) setPreview(false);
        map.easeTo({ center: [longitude, latitude], zoom: Math.max(map.getZoom(), 15), duration: 700 });
        if (step === 0) setStart(latitude, longitude);
        else setEnd(latitude, longitude);
      },
      (error) => {
        gpsBtn.disabled = false;
        status(
          error.code === error.PERMISSION_DENIED
            ? t('Location permission denied. Tap the map instead.')
            : t('Could not get a GPS fix. Tap the map instead.'),
          'bad',
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  });

  watchVisibility(mapEl, map);
}

/* ── boot ───────────────────────────────────────────────────────── */
export function boot() {
  document.querySelectorAll('[data-touge-preview]').forEach(initPreview);
  document.querySelectorAll('[data-touge-picker]').forEach((wrap) => {
    // A picker inside a hidden fieldset waits until the fieldset opens.
    if (wrap.offsetParent !== null) initTougePicker(wrap);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

window.TougeRoutePicker = { boot, initTougePicker, initPreview };
