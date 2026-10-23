/* ══════════════════════════════════════════════════════════════════
   STREETO — map picker
   MapLibre GL loaded from /vendor/maplibre (no CDN). The basemap is a
   minimal dark style: roads, road names and 3D buildings - no satellite
   imagery. See map-style.js.
   Street search is proxied through /api/places so no API key is ever
   exposed to the browser.
   ══════════════════════════════════════════════════════════════════ */

import { t } from './i18n.js';
import { MAP_STYLE } from './map-style.js';

const hasMaplibre = typeof window.maplibregl !== 'undefined';

/** Where the map opens when there is no saved spot yet - Tbilisi. */
const DEFAULT_CENTER = [44.8271, 41.7151];

/** Parse a coordinate field into a number, or null when it is not one. */
const fs = (num) => {
  if (num === null || num === undefined || num === '') return null;
  const n = Number(num);
  return Number.isFinite(n) ? n : null;
};

/** The teardrop pin, built as a DOM node so it matches the app. */
function pinElement() {
  const el = document.createElement('span');
  el.className = 'streetopin';
  el.innerHTML =
    '<span style="display:block;width:18px;height:18px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:linear-gradient(140deg,#1fe0ff,#0a9cc4);box-shadow:0 0 0 3px rgba(31,224,255,.25),0 6px 14px -4px rgba(0,0,0,.8)"></span>';
  return el;
}

/** An A/B marker for a touge route - a small labelled dot. */
function routePinElement(label, kind) {
  const el = document.createElement('span');
  el.className = `routepin routepin--${kind}`;
  el.textContent = label;
  return el;
}

/**
 * The author's avatar, built as the marker itself - a bubble that sits
 * over the spot with a small tail pointing down at it.
 * The street name is already in the card header and footer, so the pin
 * shows who is there instead.
 */
function avatarElement(el) {
  const url = (el.dataset.avatar || '').trim();
  const initials = (el.dataset.initials || '').trim();
  if (!url && !initials) return null;

  // The wrapper reserves the room for the tail, so the marker's bottom
  // edge - and with it the tip of the tail - sits exactly on the spot.
  const wrap = document.createElement('span');
  wrap.className = 'mappin-wrap';

  const box = document.createElement('span');
  box.className = 'mappin-avatar';
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    box.appendChild(img);
  } else {
    // No uploaded picture - the same generated initials badge the
    // rest of the site uses.
    box.classList.add('mappin-avatar--gen');
    box.style.setProperty('--h', el.dataset.hue || '190');
    box.textContent = initials;
  }
  wrap.appendChild(box);
  return wrap;
}

/** Build a map with the dark style used across the app. */
function buildMap(el, { center, zoom = 13, interactive = true, pitch = 0, bearing = 0 }) {
  const map = new window.maplibregl.Map({
    container: el,
    style: MAP_STYLE,
    center,
    zoom,
    pitch,
    bearing,
    interactive,
    // The tile server's own attribution (OpenFreeMap / OpenMapTiles /
    // OpenStreetMap) is shown automatically - it comes with the source.
    attributionControl: { compact: true },
    dragRotate: interactive,
    touchZoomRotate: interactive,
    maxPitch: 60,
  });
  if (!interactive) {
    map.touchZoomRotate.disable();
    map.scrollZoom.disable();
    map.dragPan.disable();
    map.doubleClickZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
  }
  // Handy handle for debugging from the console.
  el.__streetoMap = map;
  return map;
}

/** Tiles only load once the card is near the viewport. */
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

/* ── read-only pins (post cards, meetup pages) ──────────────────── */
const readOnlySeen = new WeakSet();

function initReadOnly(el) {
  if (readOnlySeen.has(el) || el.dataset.ready === '1') return;
  readOnlySeen.add(el);
  el.dataset.ready = '1';

  const lat = fs(el.dataset.lat);
  const lng = fs(el.dataset.lng);
  if (lat === null || lng === null) return;
  // 0,0 is the middle of the Atlantic, not a place.
  if (lat === 0 && lng === 0) return;

  const endLat = fs(el.dataset.routeEndLat);
  const endLng = fs(el.dataset.routeEndLng);
  const isRoute = endLat !== null && endLng !== null && !(endLat === 0 && endLng === 0);

  if (!hasMaplibre) {
    el.innerHTML = `<div style="display:grid;place-items:center;height:100%;font-size:12px;color:#858fa3">
        ${t('Pin saved at {lat}, {lng}', { lat: lat.toFixed(4), lng: lng.toFixed(4) })}<br>
        <a href="https://www.google.com/maps/search/?api=1&query=${lat},${lng}" target="_blank" rel="noopener">${t('Open in Google Maps')}</a>
      </div>`;
    return;
  }

  const map = buildMap(el, {
    center: isRoute ? [(lng + endLng) / 2, (lat + endLat) / 2] : [lng, lat],
    zoom: Number(el.dataset.zoom) || 15,
    interactive: false,
    pitch: isRoute ? 0 : 45,
    bearing: isRoute ? 0 : -18,
  });

  if (isRoute) {
    // A touge run: show where it starts (A) and where it finishes (B),
    // joined by a dashed line standing in for the road.
    map.on('load', () => {
      map.addSource('touge-route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: { type: 'LineString', coordinates: [[lng, lat], [endLng, endLat]] },
          properties: {},
        },
      });
      map.addLayer({
        id: 'touge-route-line',
        type: 'line',
        source: 'touge-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#1fe0ff',
          'line-width': 3,
          'line-opacity': 0.85,
          'line-dasharray': [1.5, 1.6],
        },
      });
      map.fitBounds([[lng, lat], [endLng, endLat]], { padding: 52, duration: 0 });
    });
    new window.maplibregl.Marker({ element: routePinElement('A', 'start'), anchor: 'bottom' })
      .setLngLat([lng, lat])
      .addTo(map);
    new window.maplibregl.Marker({ element: routePinElement('B', 'finish'), anchor: 'bottom' })
      .setLngLat([endLng, endLat])
      .addTo(map);
    watchVisibility(el, map);
    return;
  }

  // The author's avatar IS the marker - the street name is already in
  // the card header and footer, and a second pin under the avatar just
  // looked like two pins stacked.
  const bubble = avatarElement(el);
  if (bubble) {
    new window.maplibregl.Marker({ element: bubble, anchor: 'bottom' })
      .setLngLat([lng, lat])
      .addTo(map);
  } else {
    new window.maplibregl.Marker({ element: pinElement(), anchor: 'bottom' })
      .setLngLat([lng, lat])
      .addTo(map);
    if (el.dataset.label) {
      // setText, not setHTML - the label is a plain place name and must
      // never be treated as markup.
      new window.maplibregl.Popup({ offset: 16, closeButton: false, closeOnClick: false })
        .setLngLat([lng, lat])
        .setText(el.dataset.label)
        .addTo(map);
    }
  }

  watchVisibility(el, map);
}

/* ── interactive picker inside a form ───────────────────────────── */
const pickers = new WeakMap();

function initPicker(el) {
  if (pickers.has(el) || el.dataset.ready === '1') return pickers.get(el) || null;
  el.dataset.ready = '1';

  const box = el.closest('[data-map-picker-box]');
  const form = el.closest('form');
  if (!box || !form) return null;

  // A route picker prefixes its fields (`route_start_lat`), so several
  // pickers can live in one form without writing over each other.
  const prefix = (box.dataset.fieldPrefix || '').trim();
  const field = (name) => form.querySelector(`[name="${prefix}${name}"]`);
  const latField = field('lat');
  const lngField = field('lng');
  const placeField = field(prefix ? 'name' : 'place_name');
  const addressField = field('address');
  const zoomField = field('zoom');

  const statusEl = box.querySelector('[data-pin-status]');
  const bannerEl = box.querySelector('[data-pin-banner]');
  const chosenEl = box.querySelector('[data-pin-chosen]');
  const resultsEl = box.querySelector('[data-place-results]');
  const searchInput = box.querySelector('[data-place-q]');
  const searchBtn = box.querySelector('[data-place-search]');
  const gpsBtn = box.querySelector('[data-gps]');
  const clearBtn = box.querySelector('[data-pin-clear]');

  const status = (message, kind = '') => {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.classList.toggle('is-ok', kind === 'ok');
    statusEl.classList.toggle('is-bad', kind === 'bad');
  };

  /** The street name of the pin, shown over the map as a banner. */
  const setBanner = (name) => {
    if (!bannerEl) return;
    const label = String(name ?? '').trim();
    if (!label) {
      bannerEl.hidden = true;
      bannerEl.textContent = '';
      return;
    }
    bannerEl.textContent = t('Pinned: {name}', { name: label });
    bannerEl.hidden = false;
  };

  const current = () => {
    const lat = fs(latField?.value);
    const lng = fs(lngField?.value);
    if (lat === null || lng === null) return null;
    // 0,0 is in the middle of the Atlantic - it means "no spot", not a pin.
    if (lat === 0 && lng === 0) return null;
    return [lat, lng];
  };

  if (!hasMaplibre) {
    status(t('Map library missing - run `npm install` and restart. You can still type a spot name.'), 'bad');
    el.innerHTML = `<div style="display:grid;place-items:center;height:100%;font-size:12px;color:#858fa3">${t('Map unavailable')}</div>`;
    return null;
  }

  const start = current();
  // The zoom the map was left at last time, so an edited spot opens the
  // same way it was framed.
  const savedZoom = fs(zoomField?.value);
  const map = buildMap(el, {
    center: start ? [start[1], start[0]] : DEFAULT_CENTER,
    zoom: start ? (savedZoom ?? 16) : 12,
    pitch: 45,
    bearing: -18,
  });
  let marker = null;

  // The zoom level travels with the spot, so the shared map opens the
  // same way the picker was framed when the spot was chosen.
  const rememberZoom = () => {
    if (zoomField) zoomField.value = map.getZoom().toFixed(1);
  };
  map.on('moveend', rememberZoom);
  rememberZoom();

  // Let the enclosing page react to a new pin (the touge form uses this
  // to keep its route length in step).
  const announce = () => {
    form.dispatchEvent(new CustomEvent('streeto:pin', {
      bubbles: true,
      detail: { prefix, lat: fs(latField?.value), lng: fs(lngField?.value) },
    }));
  };

  const setPin = (lat, lng, { pan = true } = {}) => {
    if (latField) latField.value = lat;
    if (lngField) lngField.value = lng;
    if (!marker) {
      marker = new window.maplibregl.Marker({ element: pinElement(), anchor: 'bottom' })
        .setLngLat([lng, lat])
        .addTo(map);
    } else {
      marker.setLngLat([lng, lat]);
    }
    if (pan) map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 15) });
    if (chosenEl) chosenEl.textContent = `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
    announce();
  };

  const nameFromReverse = async (lat, lng) => {
    status(t('Naming that spot…'));
    try {
      const res = await fetch(`/api/geocode/reverse?lat=${lat}&lng=${lng}`, {
        credentials: 'same-origin',
        headers: { 'x-requested-with': 'fetch' },
      });
      const data = await res.json();
      if (data.ok && data.place) {
        const name = data.place.name || '';
        // A hidden field (the meetup form no longer shows it) follows
        // the latest pin; a visible one keeps what the driver typed.
        if (placeField && (!placeField.value || placeField.type === 'hidden')) placeField.value = name;
        if (addressField) addressField.value = data.place.label || '';
        setBanner(name || data.place.label || '');
        status('');
        return;
      }
      status(t('Pinned. Street search could not name it.'), 'bad');
    } catch {
      status(t('Pinned.'), '');
    }
  };

  map.on('click', (event) => {
    setPin(event.lngLat.lat, event.lngLat.lng, { pan: false });
    nameFromReverse(event.lngLat.lat, event.lngLat.lng);
  });

  /* street-name search */
  const runSearch = async () => {
    const q = (searchInput?.value || '').trim();
    if (q.length < 3) {
      status(t('Type at least 3 characters to search.'), 'bad');
      return;
    }
    status(t('Searching…'));
    if (searchBtn) searchBtn.disabled = true;
    try {
      const res = await fetch(`/api/places?q=${encodeURIComponent(q)}`, {
        credentials: 'same-origin',
        headers: { 'x-requested-with': 'fetch' },
      });
      const data = await res.json();
      const places = data.places || [];
      if (!places.length) {
        status(data.error || t('No matches. Try a different street name, or tap the map.'), 'bad');
        if (resultsEl) resultsEl.hidden = true;
        return;
      }
      status(t(places.length === 1 ? '{n} match - pick one.' : '{n} matches - pick one.', { n: places.length }), 'ok');
      if (resultsEl) {
        resultsEl.innerHTML = '';
        places.forEach((place) => {
          const li = document.createElement('li');
          const button = document.createElement('button');
          button.type = 'button';
          const strong = document.createElement('strong');
          strong.textContent = place.name || t('Unnamed spot');
          const span = document.createElement('span');
          span.textContent = place.label || '';
          button.append(strong, span);
          button.addEventListener('click', () => {
            setPin(place.lat, place.lng);
            if (placeField) placeField.value = place.name || '';
            if (addressField) addressField.value = place.label || '';
            resultsEl.hidden = true;
            setBanner(place.name || place.label || '');
            status('');
          });
          li.append(button);
          resultsEl.append(li);
        });
        resultsEl.hidden = false;
      }
    } catch (error) {
      status(error.message || t('Search failed. You can still tap the map.'), 'bad');
    } finally {
      if (searchBtn) searchBtn.disabled = false;
    }
  };

  searchBtn?.addEventListener('click', runSearch);
  searchInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runSearch();
    }
  });

  /* device GPS */
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
        setPin(latitude, longitude);
        nameFromReverse(latitude, longitude);
      },
      (error) => {
        gpsBtn.disabled = false;
        status(
          error.code === error.PERMISSION_DENIED
            ? t('Location permission denied. Tap the map or search a street instead.')
            : t('Could not get a GPS fix. Tap the map or search a street instead.'),
          'bad',
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  });

  clearBtn?.addEventListener('click', () => {
    if (marker) {
      marker.remove();
      marker = null;
    }
    if (latField) latField.value = '';
    if (lngField) lngField.value = '';
    if (zoomField) zoomField.value = '';
    if (chosenEl) chosenEl.textContent = '';
    if (resultsEl) resultsEl.hidden = true;
    setBanner('');
    status(t('Pin cleared. Tap the map to drop a new one.'));
    announce();
  });

  if (start) {
    setPin(start[0], start[1], { pan: false });
    if (placeField?.value) setBanner(placeField.value);
    status(t('Saved spot loaded - move the pin if you like.'), 'ok');
  } else {
    status(t('Tap the map to drop a pin, search a street, or use your GPS.'));
  }

  const api = { map, setPin, invalidate: () => map.resize() };
  pickers.set(el, api);
  setTimeout(() => map.resize(), 200);
  return api;
}

/* ── boot ───────────────────────────────────────────────────────── */
function boot() {
  document.querySelectorAll('[data-map-readonly]').forEach(initReadOnly);
  document.querySelectorAll('[data-map-picker]').forEach((el) => {
    // An interactive picker that is hidden stays dormant until opened.
    if (el.offsetParent !== null) initPicker(el);
  });
}

window.StreetoMaps = {
  init: boot,
  initPick(root) {
    (root || document).querySelectorAll('[data-map-picker]').forEach((el) => {
      const api = initPicker(el);
      api?.invalidate();
      if (api) setTimeout(() => api.invalidate(), 220);
    });
  },
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
